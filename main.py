import os
import warnings

os.environ["OPENCV_LOG_LEVEL"] = "FATAL"
os.environ["QT_LOGGING_RULES"] = "*.debug=false;qt.qpa.*=false"
warnings.filterwarnings("ignore", module="gpiozero")

import cv2
import time
import base64
import threading
import numpy as np
# pyrefly: ignore [missing-import]
from gpiozero import AngularServo, Device
from collections import deque
import re
from supabase import create_client, Client
from datetime import datetime, timezone
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# ==============================================================================
# CONFIGURATION
# ==============================================================================
import os

def load_env():
    env_dict = {}
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        if not os.path.exists(env_path):
            alt_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "new_qr-main", ".env")
            if os.path.exists(alt_path):
                env_path = alt_path
        with open(env_path) as f:
            for line in f:
                if line.strip() and not line.startswith("#"):
                    key, val = line.strip().split("=", 1)
                    env_dict[key.strip()] = val.strip().strip("'\"")
    except FileNotFoundError:
        print("Warning: .env file not found. Using default configs.")
    return env_dict

print("DEBUG: Startup - Loading environment variables...")
env_vars = load_env()
SUPABASE_URL = env_vars.get("SUPABASE_URL", "https://nrrbkvtwnoqshtzliijq.supabase.co")
SUPABASE_KEY = env_vars.get("SUPABASE_SERVICE_ROLE_KEY", env_vars.get("PRIVATE_SUPABASE_SERVICE_ROLE_KEY", ""))
GATE_API_KEY = env_vars.get("PRIVATE_GATE_API_KEY", "replace-with-a-secure-random-gate-key")
CAMERA_ZOOM = 1.8  # 1.0 = normal full view, 1.8 = zoom for clear QR resolution

# Initialize Supabase client
print("DEBUG: Startup - Initializing Supabase client...")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print("DEBUG: Startup - Supabase client initialized.")

# ------------------------------------------------------------------------------
# GPIO pin factory setup (Raspberry Pi OS "Trixie" / Python 3.13 / Pi 4)
# ------------------------------------------------------------------------------
# On Trixie:
#   * pigpio has been dropped from the apt repos entirely (it can't run on a
#     Pi 5, so it was pulled for every board), so gpiozero's automatic
#     fallback to pigpio will always fail here.
#   * the `lgpio` PyPI wheel isn't built for Python 3.13 yet, so
#     `pip install lgpio` tries to compile it from source, which needs swig
#     -- and even after installing swig, the build can still fail.
#
# The reliable fix is to skip pip for the GPIO libraries altogether and use
# the versions Raspberry Pi OS Trixie already ships via apt (precompiled for
# Python 3.13 / aarch64), then point gpiozero directly at lgpio instead of
# letting it probe every backend in turn.
#
# One-time setup on the Pi (run once, outside any venv):
#   sudo apt update
#   sudo apt install python3-lgpio python3-gpiozero
#
# If this script runs inside a virtualenv, it needs to be created (or
# recreated) with access to those system packages:
#   python3 -m venv --system-site-packages venv
#   source venv/bin/activate
#   pip install opencv-python requests pyzbar   # everything EXCEPT gpio libs
#
# Do not pip install lgpio or pigpio -- that's what triggers the swig build.

print("DEBUG: Startup - Setting up GPIO factory...")
try:
    from gpiozero.pins.lgpio import LGPIOFactory
    Device.pin_factory = LGPIOFactory()
except Exception as e:
    print(
        "Warning: could not load the lgpio pin factory (mock mode).\n"
        "  Fix: sudo apt install python3-lgpio python3-gpiozero\n"
        "  If you're in a venv, recreate it with --system-site-packages so "
        "it can see those apt-installed packages.\n"
        f"  Underlying error: {e}"
    )

MIN_PW = 0.0005
MAX_PW = 0.0025

try:
    print("DEBUG: Initializing servos...")
    servo_in = AngularServo(13, min_pulse_width=MIN_PW, max_pulse_width=MAX_PW, initial_angle=0)
    servo_out = AngularServo(19, min_pulse_width=MIN_PW, max_pulse_width=MAX_PW, initial_angle=0)
    
    # Detach servos after a short delay to prevent idle stuttering
    def _detach_servos_init():
        time.sleep(1)
        try:
            servo_in.angle = None
            servo_out.angle = None
            print("DEBUG: Initial servo PWM disabled to prevent idle stuttering")
        except:
            pass
    threading.Thread(target=_detach_servos_init, daemon=True).start()
    
    print("DEBUG: Servos initialized successfully")
    print(f"DEBUG: servo_in type: {type(servo_in)}")
    print(f"DEBUG: servo_out type: {type(servo_out)}")
    print("DEBUG: Servos set to initial position 0 degrees (closed)")
except Exception as e:
    print("Warning: GPIO not available (mock mode).", e)
    class MockServo:
        def __init__(self): 
            self._angle = 0
            print("DEBUG: MockServo initialized")
        @property
        def angle(self):
            return self._angle
        @angle.setter
        def angle(self, value):
            self._angle = value
            print(f"DEBUG: MockServo angle set to {value} degrees")
    servo_in = MockServo()
    servo_out = MockServo()
    print("DEBUG: Using mock servos (motors won't move)")

# ==============================================================================
# STATE & DATA
# ==============================================================================
class GateState:
    SCANNING = "SCANNING"
    DETECTED = "DETECTED"
    INVALID_QR = "INVALID_QR"
    API_ERROR = "API_ERROR"
    WARNING = "WARNING"
    TIMEOUT = "TIMEOUT"
    PROLONG = "PROLONG"               # Permanent barrier open mode for rush / convoy
    MANUAL_TYPE = "MANUAL_TYPE"       # Ask: Registered or Guest?
    MANUAL_REG = "MANUAL_REG"         # Ask: Plate number or Reg. No.
    MANUAL_GUEST_IN = "MANUAL_GUEST_IN"   # Ask: Name, Plate, ID Number, Purpose
    MANUAL_GUEST_CONFIRM = "MANUAL_GUEST_CONFIRM"  # Confirm/Reject after filling form
    MANUAL_GUEST_OUT = "MANUAL_GUEST_OUT" # Ask: Search by Name or Plate
    MANUAL_GUEST_SEARCH_RESULT = "MANUAL_GUEST_SEARCH_RESULT"  # Display search result
    GUEST_WARNING = "GUEST_WARNING"
    LOG_WARNING = "LOG_WARNING"  # Same-day double-in or double-out warning
    PROCESSING = "PROCESSING"   # QR detected, waiting for API response
    CAMPUS_FULL = "CAMPUS_FULL"
    BLOCKED = "BLOCKED"         # Registration / vehicle is on the blocklist: entry denied
    TYPE_FULL = "TYPE_FULL"     # No free 2-wheel (or 4-wheel) slots for this vehicle's type
    STATUS_DENIED = "STATUS_DENIED"  # QR belongs to a revoked / not-yet-registered / expired application

class SideState:
    def __init__(self, gate_type):
        self.type = gate_type # 'in' or 'out'
        self.state = GateState.SCANNING
        self.data = None # Holds QR text, or vehicle info dict
        self.snapshot = None # Image captured at moment of scan/action
        self.timeout_end = 0
        self.api_error = ""
        self.anomaly_id = None
        self.anomaly_desc = ""
        self.logged_status = None
        self.vehicle_data = {} # Holds vehicle information from separate table
        self.block_info = None # Active blocklist row when state is BLOCKED
        self.prolong_ready_time = 0.0 # Cooldown timer for PROLONG scans (5s delay)
        self.scan_cooldown_end = 0.0  # Cooldown timer for Exit scanner (5s delay between scans)
        
        # Manual Form Data
        self.input_field = 0 # which field is active
        self.form_data = ["", "", ""] # e.g. [plate, id_number, purpose] or [plate]
        self.ticket_generated = ""
        self.anim_offset = 0.0 if gate_type == 'in' else 1.5
        self.last_prolong_exit = {}

side_in = SideState('in')
side_out = SideState('out')

global_stats = {"currentlyIn": 0, "visitsToday": 0, "maxCapacity": 200, "availableSlots": 200, "eventName": "",
                "cap2": None, "cap4": None, "in2": 0, "in4": 0}
global_logs = []
latest_scanned_details = None
log_scroll_offset = 0
CURRENT_VIEW = 'in'  # 'in' for Entrance Camera (expanded), 'out' for Exit Camera (expanded)
CREAM_BG = (235, 244, 248)  # Warm cream background for dashboard (BGR)

# ==============================================================================
# LIVE CAMERA MJPEG STREAMING SERVER (For Security Admin Dashboard)
# ==============================================================================
latest_stream_lock = threading.Lock()
latest_stream_in_jpeg = None
latest_stream_out_jpeg = None
latest_stream_active_jpeg = None
stream_server_started = False

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class CameraStreamHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silence console log spam for HTTP streaming requests
        return

    def do_OPTIONS(self):   
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_GET(self):
        clean_path = self.path.split('?')[0].rstrip('/')
        if clean_path in ('/video_feed', '/video_feed/in', '/video_feed/out', '/stream', ''):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Age', '0')
            self.send_header('Cache-Control', 'no-cache, private')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.end_headers()

            feed_kind = 'in' if '/in' in clean_path else ('out' if '/out' in clean_path else 'active')

            try:
                while True:
                    frame_bytes = None
                    with latest_stream_lock:
                        if feed_kind == 'in':
                            frame_bytes = latest_stream_in_jpeg or latest_stream_active_jpeg
                        elif feed_kind == 'out':
                            frame_bytes = latest_stream_out_jpeg or latest_stream_active_jpeg
                        else:
                            frame_bytes = latest_stream_active_jpeg or latest_stream_in_jpeg

                    if frame_bytes:
                        self.wfile.write(b'--frame\r\n')
                        self.wfile.write(b'Content-Type: image/jpeg\r\n')
                        self.wfile.write(f'Content-Length: {len(frame_bytes)}\r\n\r\n'.encode('utf-8'))
                        self.wfile.write(frame_bytes)
                        self.wfile.write(b'\r\n')
                    time.sleep(0.04)  # ~25 FPS
            except (ConnectionResetError, BrokenPipeError):
                pass
            except Exception:
                pass

        elif clean_path == '/snapshot':
            frame_bytes = None
            with latest_stream_lock:
                frame_bytes = latest_stream_active_jpeg or latest_stream_in_jpeg
            if frame_bytes:
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(frame_bytes)))
                self.end_headers()
                self.wfile.write(frame_bytes)
            else:
                self.send_response(503)
                self.end_headers()

        elif clean_path in ('/status', '/info'):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            info = {
                "campus": globals().get("SELECTED_CAMPUS") or "Main",
                "active_view": globals().get("CURRENT_VIEW", "in"),
                "dual_camera": globals().get("has_dual_cam", False),
                "currently_in": global_stats.get("currentlyIn", 0),
                "timestamp": datetime.now().isoformat()
            }
            self.wfile.write(json.dumps(info).encode('utf-8'))

        else:
            self.send_response(404)
            self.end_headers()

def start_camera_stream_server():
    """Start threaded HTTP streaming server so security dashboard can stream live video."""
    global stream_server_started
    if stream_server_started:
        return
    stream_server_started = True

    port = 5000
    if env_vars.get("STREAM_PORT"):
        try:
            port = int(env_vars.get("STREAM_PORT"))
        except:
            port = 5000
    else:
        c = str(globals().get('SELECTED_CAMPUS') or 'Main').strip().lower()
        if 'rnp' in c: port = 5001
        elif 'paseo' in c: port = 5002
        else: port = 5000

    for p in [port, port + 1, port + 2, 5000, 5001, 5002]:
        try:
            httpd = ThreadedHTTPServer(('0.0.0.0', p), CameraStreamHandler)
            print(f"DEBUG: Camera live feed server active at http://0.0.0.0:{p}/video_feed")
            httpd.serve_forever()
            break
        except OSError:
            continue
        except Exception as e:
            print(f"Warning: Stream server failed on port {p}: {e}")
            break


# ==============================================================================
# SUPABASE HELPERS
# ==============================================================================
def img_to_b64(img):
    if img is None: return None
    _, buffer = cv2.imencode('.jpg', img)
    return "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')

is_connected = True

class _EmptyResponse:
    data = []

def normalize_campus_name(campus_val):
    """Normalize campus string to one of: 'Main Campus', 'RNP', 'PASEO'"""
    c_lower = str(campus_val or 'Main').strip().lower()
    if 'rnp' in c_lower:
        return 'RNP'
    elif 'paseo' in c_lower:
        return 'PASEO'
    return 'Main Campus'

def get_campus_gate_and_name():
    """Return (campus_gate_enum, campus_name) matching database schema:
    campus_gate_enum: 'main', 'rnp', 'paseo'
    campus: 'Main Campus', 'RNP', 'PASEO'"""
    campus = globals().get('SELECTED_CAMPUS')
    norm = normalize_campus_name(campus)
    gate = 'rnp' if norm == 'RNP' else ('paseo' if norm == 'PASEO' else 'main')
    return gate, norm

def get_latest_parking_row():
    """Latest parking_availability row for the campus selected at boot."""
    campus = globals().get('SELECTED_CAMPUS')
    if not campus:
        return _EmptyResponse()
    gate, norm_campus = get_campus_gate_and_name()
    return supabase.table('parking_capacity').select('*').ilike('campus', f"%{norm_campus}%").order('date_time', desc=True).limit(1).execute()

def get_campus_occupied(campus_name=None):
    """Count active occupied vehicles inside campus (entry records +1 occupied, exit records -1 occupied).
    If check_in is present and check_out is null and status is not exited/denied: occupied = 1.
    When an exit is recorded (check_out is set or status is exited_campus): occupied drops to 0 (unoccupied increases).
    Applies to registered vehicles, guest logs, and VIP logs across all campuses."""
    target_campus = campus_name or globals().get('SELECTED_CAMPUS')
    if not target_campus:
        return 0
    c_lower = str(target_campus).strip().lower()
    norm_campus = 'RNP' if 'rnp' in c_lower else ('PASEO' if 'paseo' in c_lower else 'Main Campus')
    try:
        res = supabase.table('vehicle_log').select('vehicle_log_id, check_in, check_out, logged_status, campus, campus_gate, registration_id, vip_access, guest_id, vehicle_information:vehicle_information_id(type)').ilike('campus', f"%{norm_campus}%").execute()
        global_stats['in2'] = 0
        global_stats['in4'] = 0
        if res.data:
            seen_vehicles = set()
            active_occupied = 0
            # Get placeholder reg id if known
            placeholder_reg_id = _placeholder_ids[0] if globals().get('_placeholder_ids') else None
            for r in res.data:
                st = str(r.get('logged_status', '')).strip().lower()
                has_in = bool(r.get('check_in'))
                has_out = bool(r.get('check_out'))
                is_exited = has_out or st in ('denied', 'exit', 'out', 'exited', 'exited_campus')
                if has_in and not is_exited:
                    reg_id = r.get('registration_id')
                    # If it's a guest or VIP log (or uses placeholder registration), key by vehicle_log_id
                    if not reg_id or (placeholder_reg_id and reg_id == placeholder_reg_id) or st in ('guest', 'vip') or r.get('is_vip') or r.get('vip_access') or r.get('guest_id'):
                        v_key = f"log_{r.get('vehicle_log_id')}"
                    else:
                        v_key = f"reg_{reg_id}"
                    if v_key not in seen_vehicles:
                        seen_vehicles.add(v_key)
                        active_occupied += 1
                        # Unknown type (guest / VIP placeholder) counts as 4-wheel, same as the web dashboard
                        if is_two_wheeler((r.get('vehicle_information') or {}).get('type')):
                            global_stats['in2'] += 1
                        else:
                            global_stats['in4'] += 1
            return active_occupied
        return 0
    except Exception as e:
        print(f"DEBUG: Error querying occupied count for {norm_campus}: {e}")
        return 0

def is_two_wheeler(vehicle_type):
    t = str(vehicle_type or '').lower()
    return '2' in t or 'motor' in t or 'bike' in t or 'scooter' in t

def read_type_limits(row):
    """(capacity, cap2, cap4) from a parking_capacity row; total is cap2 + cap4 once both are set."""
    row = row or {}
    cap2 = row.get('capacity_2_wheels')
    cap4 = row.get('capacity_4_wheels')
    if cap2 is not None and cap4 is not None:
        return cap2 + cap4, cap2, cap4
    return row.get('parking_capacity') or row.get('capacity') or 200, cap2, cap4

def get_live_currently_in(campus_name=None):
    """Count active vehicles currently inside selected campus. Alias for get_campus_occupied."""
    return get_campus_occupied(campus_name)

def sync_parking_availability(occupied_count=None):
    """Sync live counts to parking_availability in Supabase so web dashboard matches 1:1.
    Entry adds 1 to occupied and subtracts 1 from unoccupied.
    Exit subtracts 1 from occupied and adds 1 to unoccupied.
    Applies to all campuses."""
    campus = globals().get('SELECTED_CAMPUS')
    if not campus:
        return
    gate, norm_campus = get_campus_gate_and_name()
        
    try:
        pa_res = supabase.table('parking_capacity').select('*').ilike('campus', f"%{norm_campus}%").order('date_time', desc=True).limit(1).execute()
        capacity, cap2, cap4 = read_type_limits(pa_res.data[0] if pa_res.data else None)
        global_stats['cap2'] = cap2
        global_stats['cap4'] = cap4

        if occupied_count is None:
            occupied_count = get_campus_occupied(norm_campus)
            
        unoccupied = max(0, capacity - occupied_count)
        now_iso = datetime.now().isoformat()
        
        ev_name = (pa_res.data[0].get('event_name') or pa_res.data[0].get('event') or '') if pa_res.data else ''
        if not ev_name:
            try:
                ce_res = supabase.table('campus_event').select('event_name').eq('campus_gate', gate).eq('is_active', True).order('created_at', desc=True).limit(1).execute()
                if ce_res.data and ce_res.data[0].get('event_name'):
                    ev_name = ce_res.data[0]['event_name']
            except:
                pass

        if pa_res.data:
            last_id = pa_res.data[0]['parking_availability_id']
            supabase.table('parking_capacity').update({
                "parking_capacity": capacity,
                "capacity": capacity,
                "slot_occupied": occupied_count,
                "occupied": occupied_count,
                "slot_unoccupied": unoccupied,
                "available": unoccupied,
                "occupied_2_wheels": global_stats.get('in2', 0),
                "occupied_4_wheels": global_stats.get('in4', 0),
                "campus_gate": gate,
                "event_name": ev_name.strip() if ev_name else None,
                "date_time": now_iso,
                "recorded_at": now_iso
            }).eq('parking_availability_id', last_id).execute()
        else:
            supabase.table('parking_capacity').insert({
                "campus": norm_campus,
                "campus_gate": gate,
                "parking_capacity": capacity,
                "capacity": capacity,
                "slot_occupied": occupied_count,
                "occupied": occupied_count,
                "slot_unoccupied": unoccupied,
                "available": unoccupied,
                "event_name": ev_name.strip() if ev_name else None,
                "date_time": now_iso,
                "recorded_at": now_iso
            }).execute()

        global_stats['maxCapacity'] = capacity
        global_stats['currentlyIn'] = occupied_count
        global_stats['availableSlots'] = unoccupied
        global_stats['eventName'] = ev_name.strip() if ev_name else ''
        print(f"DEBUG: Synced parking ({norm_campus}) -> Occupied: {occupied_count}, Unoccupied: {unoccupied}, Event: {global_stats['eventName']}")
    except Exception as e:
        print(f"DEBUG: Error in sync_parking_availability: {e}")

def refresh_parking_data():
    """Manually refresh parking availability data from database"""
    global global_stats
    try:
        campus = globals().get('SELECTED_CAMPUS')
        if not campus:
            return
        gate, norm_campus = get_campus_gate_and_name()

        pa_res = supabase.table('parking_capacity').select('*').ilike('campus', f"%{norm_campus}%").order('date_time', desc=True).limit(1).execute()
        capacity, cap2, cap4 = read_type_limits(pa_res.data[0] if pa_res.data else None)
        global_stats['cap2'] = cap2
        global_stats['cap4'] = cap4

        ev_name = (pa_res.data[0].get('event_name') or pa_res.data[0].get('event') or '') if pa_res.data else ''
        if not ev_name:
            try:
                ce_res = supabase.table('campus_event').select('event_name').eq('campus_gate', gate).eq('is_active', True).order('created_at', desc=True).limit(1).execute()
                if ce_res.data and ce_res.data[0].get('event_name'):
                    ev_name = ce_res.data[0]['event_name']
            except:
                pass

        live_occupied = get_campus_occupied(norm_campus)
        avail = max(0, capacity - live_occupied)

        global_stats['maxCapacity'] = capacity
        global_stats['currentlyIn'] = live_occupied
        global_stats['availableSlots'] = avail
        global_stats['eventName'] = ev_name.strip() if ev_name else ''
        print(f"DEBUG: Parking refreshed ({campus}) -> Cap: {capacity}, Occupied: {live_occupied}, Unoccupied: {avail}, Event: {global_stats['eventName']}")
    except Exception as e:
        print(f"Error in refresh_parking_data: {e}")

def poll_supabase():
    global global_stats, is_connected
    while True:
        try:
            campus = globals().get('SELECTED_CAMPUS')
            if campus:
                gate, norm_campus = get_campus_gate_and_name()

                pa_res = supabase.table('parking_capacity').select('*').ilike('campus', f"%{norm_campus}%").order('date_time', desc=True).limit(1).execute()
                capacity, cap2, cap4 = read_type_limits(pa_res.data[0] if pa_res.data else None)
                global_stats['cap2'] = cap2
                global_stats['cap4'] = cap4

                ev_name = (pa_res.data[0].get('event_name') or pa_res.data[0].get('event') or '') if pa_res.data else ''
                if not ev_name:
                    try:
                        ce_res = supabase.table('campus_event').select('event_name').eq('campus_gate', gate).eq('is_active', True).order('created_at', desc=True).limit(1).execute()
                        if ce_res.data and ce_res.data[0].get('event_name'):
                            ev_name = ce_res.data[0]['event_name']
                    except:
                        pass

                live_occupied = get_campus_occupied(norm_campus)
                avail = max(0, capacity - live_occupied)

                global_stats['maxCapacity'] = capacity
                global_stats['currentlyIn'] = live_occupied
                global_stats['availableSlots'] = avail
                global_stats['eventName'] = ev_name.strip() if ev_name else ''

            if not is_connected:
                print("Supabase Polling: Connection restored!")
                is_connected = True
        except Exception as e:
            if is_connected:
                print(f"Supabase Polling error: {type(e).__name__}: {e}")
                is_connected = False
        time.sleep(2)

print("DEBUG: Startup - Starting Supabase polling thread...")
threading.Thread(target=poll_supabase, daemon=True).start()

def start_prolong_gate(side):
    """Open barrier permanently on Exit and start PROLONG mode"""
    print(f"DEBUG: Activating PROLONG mode on {side.type} gate - Barrier held permanently open")
    servo = servo_in if side.type == 'in' else servo_out
    set_servo_angle(servo, 90)
    side.state = GateState.PROLONG
    side.scan_cooldown_end = 0.0
    side.prolong_ready_time = 0.0
    side.data = None
    side.logged_status = None

def close_prolong_gate(side):
    """Close barrier from PROLONG mode and return to normal SCANNING"""
    print(f"DEBUG: Deactivating PROLONG mode on {side.type} gate - Barrier closing")
    servo = servo_in if side.type == 'in' else servo_out
    set_servo_angle(servo, 0)
    side.state = GateState.SCANNING
    side.scan_cooldown_end = time.time() + 5.0
    side.data = None
    side.logged_status = None
    if hasattr(side, 'last_prolong_exit'):
        side.last_prolong_exit = None
    global latest_scanned_details
    latest_scanned_details = None

# ==============================================================================
# ACTION HANDLERS
# ==============================================================================
def set_servo_angle(servo, target_angle):
    def _move():
        try:
            print(f"DEBUG: Starting servo movement to {target_angle} degrees")
            print(f"DEBUG: Servo object: {servo}")
            print(f"DEBUG: Servo type: {type(servo)}")
            
            # Check if servo is valid
            if servo is None:
                print(f"DEBUG: ERROR - Servo object is None")
                return
            
            # Set the servo angle
            servo.angle = target_angle
            print(f"DEBUG: Servo angle set to {target_angle}")
            
            # Increased sleep time to ensure servo completes movement
            time.sleep(2)
            
            # Set to None to stop PWM pulses, fixing the stuttering issue
            servo.angle = None
            print(f"DEBUG: Servo movement completed, PWM disabled to prevent stuttering")
        except AttributeError as e:
            print(f"DEBUG: Servo AttributeError: {e}")
            print(f"DEBUG: Servo object details: {servo}")
        except Exception as e:
            print(f"DEBUG: Servo movement error: {type(e).__name__}: {e}")
    threading.Thread(target=_move, daemon=True).start()

def open_gate(side):
    print(f"DEBUG: Opening {side.type} gate")
    try:
        servo = servo_in if side.type == 'in' else servo_out
        print(f"DEBUG: Using servo: {servo}")
        print(f"DEBUG: Servo type: {type(servo)}")
        
        if servo is None:
            print(f"DEBUG: ERROR - Servo is None for {side.type} gate")
            side.state = GateState.API_ERROR
            side.api_error = "Servo not available"
            return
        
        set_servo_angle(servo, 90)
        side.state = GateState.TIMEOUT
        side.timeout_end = time.time() + 15  # 15 seconds countdown for normal operations
        if side.type == 'out':
            side.scan_cooldown_end = time.time() + 5.0
            side.prolong_ready_time = time.time() + 5.0
        print(f"DEBUG: Gate opened, 15-second countdown started")
    except Exception as e:
        print(f"DEBUG: Error in open_gate: {type(e).__name__}: {e}")
        side.state = GateState.API_ERROR
        side.api_error = f"Gate open failed: {str(e)}"

def force_close_gate(side):
    """Force close the gate immediately regardless of state"""
    print(f"DEBUG: Force closing {side.type} gate")
    servo = servo_in if side.type == 'in' else servo_out
    set_servo_angle(servo, 0)
    side.state = GateState.SCANNING
    side.data = None
    side.logged_status = None
    side.timeout_end = 0
    global latest_scanned_details
    latest_scanned_details = None

def manual_open_gate(side):
    """Manually open gate without database operations - direct motor control only"""
    print(f"DEBUG: Manual open gate for {side.type}")
    servo = servo_in if side.type == 'in' else servo_out
    set_servo_angle(servo, 90)
    side.state = GateState.TIMEOUT
    side.timeout_end = time.time() + 15  # 15 seconds countdown for manual operations
    print(f"DEBUG: Manual gate open complete, 15-second countdown started")

def close_gate(side):
    print(f"DEBUG: Closing {side.type} gate")
    servo = servo_in if side.type == 'in' else servo_out
    set_servo_angle(servo, 0)
    side.state = GateState.SCANNING
    side.data = None
    side.logged_status = None
    global latest_scanned_details
    latest_scanned_details = None
    print(f"DEBUG: Gate closed successfully")

# ==============================================================================
# REGISTERED VEHICLE CHECK (shared by QR scan and manual plate lookup)
# ==============================================================================
def parse_db_timestamp(value):
    """Parse a Supabase timestamptz string into an aware UTC datetime (None if invalid)."""
    if not value:
        return None
    try:
        txt = str(value).strip().replace('Z', '+00:00').replace(' ', 'T', 1)
        # Python < 3.11 only accepts 3 or 6 fractional second digits
        txt = re.sub(r'\.(\d+)', lambda m: '.' + (m.group(1) + '000000')[:6], txt, count=1)
        dt = datetime.fromisoformat(txt)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None

def format_remaining(until_value):
    """Human readable time left until a blocklist blocked_until timestamp, e.g. '2d 03h 15m 20s'."""
    until = parse_db_timestamp(until_value)
    if not until:
        return "N/A"
    secs = int((until - datetime.now(timezone.utc)).total_seconds())
    if secs <= 0:
        return "EXPIRED"
    days, rem = divmod(secs, 86400)
    hours, rem = divmod(rem, 3600)
    mins, secs = divmod(rem, 60)
    if days:
        return f"{days}d {hours:02d}h {mins:02d}m {secs:02d}s"
    return f"{hours:02d}h {mins:02d}m {secs:02d}s"

def get_active_block(registration_id, vehicle_id):
    """Return the active gate block (3rd violation level, latest blocked_until) for this registration
    or vehicle, else None. 1st and 2nd warnings never block the gate.
    The blocklist table is shared, so this applies at every campus gate."""
    filters = []
    try:
        if registration_id:
            filters.append(f"registration_id.eq.{int(registration_id)}")
        if vehicle_id:
            filters.append(f"vehicle_id.eq.{int(vehicle_id)}")
    except (TypeError, ValueError):
        pass
    if not filters:
        return None
    try:
        now_utc = datetime.now(timezone.utc)
        res = supabase.table('blocklist').select('*')\
            .or_(','.join(filters))\
            .eq('violation_level', 'gate_block')\
            .gt('blocked_until', now_utc.strftime('%Y-%m-%dT%H:%M:%SZ'))\
            .order('blocked_until', desc=True).limit(1).execute()
        for row in (res.data or []):
            until = parse_db_timestamp(row.get('blocked_until'))
            if until and until > now_utc:
                return row
    except Exception as e:
        # Gate keeps working if the blocklist table is unreachable; the error is logged for the admin
        print(f"DEBUG: Blocklist lookup failed: {e}")
    return None

def show_blocked(side, reg, block):
    """Switch the gate to the BLOCKED screen and show the vehicle details with the block status."""
    global latest_scanned_details
    side.block_info = block
    side.data = reg
    first_n = reg.get('first_name', '')
    last_n = reg.get('last_name', '')
    v_brand = side.vehicle_data.get('brand') or reg.get('brand') or 'N/A'
    v_color = side.vehicle_data.get('color') or ''
    latest_scanned_details = {
        "gate": "ENTRANCE" if side.type == 'in' else "EXIT",
        "name": f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A',
        "role": (reg.get('role') or 'N/A').capitalize(),
        "plate": side.vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A',
        "brand": f"{v_brand} ({v_color})" if v_color else v_brand,
        "type": side.vehicle_data.get('type') or reg.get('type') or 'N/A',
        "status": "BLOCKED",
        "time": datetime.now().strftime("%I:%M:%S %p")
    }
    print(f"[{side.type}] BLOCKED registration {reg.get('registration_id')}: {block.get('reason')} (until {block.get('blocked_until')})")

    # Record the refused attempt so it appears in the security dashboard's Flagged Alerts
    try:
        gate_enum, campus_name = get_campus_gate_and_name()
        now_iso = datetime.now().isoformat()
        supabase.table('vehicle_log').insert({
            "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id'),
            "registration_id": reg.get('registration_id'),
            "check_in": now_iso,
            "check_out": now_iso,
            "logged_status": "denied",
            "sticker_status": "registered",
            "campus_gate": gate_enum,
            "campus": campus_name,
            "flagged_alert": "blocked",
            "reason": f"BLOCKED - entry denied ({format_remaining(block.get('blocked_until'))} left): {block.get('reason') or 'No reason given'}"
        }).execute()
    except Exception as e:
        print(f"DEBUG: Error logging blocked attempt: {e}")

    side.state = GateState.BLOCKED

def registration_access(reg):
    """(allowed, alert_kind, title, detail) for a registration's current status.
    Only registered (approved / completed) stickers that have not expired may enter."""
    status = str(reg.get('status') or '').strip().lower()
    if status == 'revoked':
        reason = reg.get('revoke_reason') or 'No reason given'
        return False, 'revoked', "REVOKED", f"Revoked by OSA: {reason}. Access returns only after the QR is unrevoked."
    if status in ('approved', 'completed'):
        expires = parse_db_timestamp(reg.get('expires_at'))
        if expires and expires < datetime.now(timezone.utc):
            return False, 'not_registered', "STICKER EXPIRED", f"Sticker expired on {expires.astimezone().strftime('%b %d, %Y')}."
        return True, None, None, None
    label = status.replace('_', ' ').upper() or 'UNKNOWN'
    return False, 'not_registered', "NOT REGISTERED", f"Application status is {label}; the sticker is not active yet."

def exit_flag_for(reg, vehicle_id=None):
    """Alert to record when a vehicle that should not have access leaves (exits are still allowed)."""
    allowed, kind, title, detail = registration_access(reg)
    if not allowed:
        return kind, f"{title} QR used at exit (allowed out): {detail}"
    block = get_active_block(reg.get('registration_id'), vehicle_id or reg.get('vehicle_information_id'))
    if block:
        return 'blocked', f"Blocked vehicle exited ({format_remaining(block.get('blocked_until'))} left): {block.get('reason') or 'No reason given'}"
    return None

def show_status_denied(side, reg, kind, title, detail):
    """Entrance refused because the QR is revoked, expired or not registered yet."""
    global latest_scanned_details
    side.data = reg
    side.denied_info = (title, detail, str(reg.get('status') or '').upper())
    first_n = reg.get('first_name', '')
    last_n = reg.get('last_name', '')
    v_brand = side.vehicle_data.get('brand') or reg.get('brand') or 'N/A'
    v_color = side.vehicle_data.get('color') or ''
    latest_scanned_details = {
        "gate": "ENTRANCE",
        "name": f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A',
        "role": (reg.get('role') or 'N/A').capitalize(),
        "plate": side.vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A',
        "brand": f"{v_brand} ({v_color})" if v_color else v_brand,
        "type": side.vehicle_data.get('type') or reg.get('type') or 'N/A',
        "status": title,
        "time": datetime.now().strftime("%I:%M:%S %p")
    }
    try:
        gate_enum, campus_name = get_campus_gate_and_name()
        now_iso = datetime.now().isoformat()
        supabase.table('vehicle_log').insert({
            "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id'),
            "registration_id": reg.get('registration_id'),
            "check_in": now_iso,
            "check_out": now_iso,
            "logged_status": "denied",
            "sticker_status": "registered" if kind == 'revoked' else "unregistered",
            "campus_gate": gate_enum,
            "campus": campus_name,
            "flagged_alert": kind,
            "reason": f"{title} - entry denied: {detail}"
        }).execute()
    except Exception as e:
        print(f"DEBUG: Error logging denied {kind} attempt: {e}")
    print(f"[{side.type}] {title}: registration {reg.get('registration_id')} denied entry")
    side.state = GateState.STATUS_DENIED

def evaluate_registered_vehicle(side, reg, vehicle_data=None, auto_exit=True):
    """Decide what the gate shows for a registered vehicle: BLOCKED, duplicate-entry / wrong-campus
    warnings, auto exit, or DETECTED (LET IN / DENY). Manual access passes auto_exit=False so the
    guard always confirms with LET OUT / DENY."""
    global latest_scanned_details
    side.data = reg
    side.block_info = None

    # Get vehicle information from separate table (the manual plate lookup may already have it)
    try:
        print(f"DEBUG: Registration data: {reg}")
        vehicle_info_id = reg.get('vehicle_information_id')
        print(f"DEBUG: vehicle_information_id from registration: {vehicle_info_id}")
        
        if vehicle_data:
            side.vehicle_data = vehicle_data
        elif vehicle_info_id:
            vehicle_response = supabase.table('vehicle_information').select('*').eq('vehicle_information_id', vehicle_info_id).execute()
            print(f"DEBUG: Vehicle response data: {vehicle_response.data}")
            if vehicle_response.data:
                vehicle_data = vehicle_response.data[0]
                # Store vehicle data in a separate field
                side.vehicle_data = vehicle_data
                print(f"DEBUG: Vehicle data loaded successfully: {vehicle_data}")
            else:
                print(f"DEBUG: No vehicle found with vehicle_information_id: {vehicle_info_id}")
                side.vehicle_data = {}
        else:
            print(f"DEBUG: No vehicle_information_id in registration")
            side.vehicle_data = {}
    except Exception as e:
        print(f"Error fetching vehicle information: {e}")
        side.vehicle_data = {}
    
    side.exit_flag = None
    if side.type == 'out':
        # Exits are always allowed so no car is trapped inside; a revoked / unregistered / blocked QR is flagged
        side.exit_flag = exit_flag_for(reg, side.vehicle_data.get('vehicle_information_id'))

    # Registration status (all campuses): only active registered stickers may enter
    if side.type == 'in':
        allowed, kind, title, detail = registration_access(reg)
        if not allowed:
            show_status_denied(side, reg, kind, title, detail)
            return

    # Blocklist check (all campuses). Applies to the entrance; a blocked vehicle already inside may still leave.
    if side.type == 'in':
        block = get_active_block(reg.get('registration_id'), side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id'))
        if block:
            show_blocked(side, reg, block)
            return

        # Separate 2-wheel / 4-wheel limits: stop this vehicle only if its own type is full
        two_wheel = is_two_wheeler(side.vehicle_data.get('type') or reg.get('type'))
        type_cap = global_stats.get('cap2') if two_wheel else global_stats.get('cap4')
        type_in = global_stats.get('in2', 0) if two_wheel else global_stats.get('in4', 0)
        if type_cap is not None and type_in >= type_cap:
            side.full_type_label = "2-WHEEL" if two_wheel else "4-WHEEL"
            side.full_type_counts = (type_in, type_cap)
            first_n = reg.get('first_name', '')
            last_n = reg.get('last_name', '')
            v_brand = side.vehicle_data.get('brand') or reg.get('brand') or 'N/A'
            v_color = side.vehicle_data.get('color') or ''
            latest_scanned_details = {
                "gate": "ENTRANCE",
                "name": f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A',
                "role": (reg.get('role') or 'N/A').capitalize(),
                "plate": side.vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A',
                "brand": f"{v_brand} ({v_color})" if v_color else v_brand,
                "type": side.vehicle_data.get('type') or reg.get('type') or 'N/A',
                "status": f"{side.full_type_label} PARKING FULL",
                "time": datetime.now().strftime("%I:%M:%S %p")
            }
            side.state = GateState.TYPE_FULL
            return

    # Multi-campus duplicate entry check:
    # Query recent logs for this registration across ALL campuses to detect if vehicle is currently inside
    open_cross_log = None
    try:
        all_logs_res = supabase.table('vehicle_log').select('*')\
            .eq('registration_id', reg['registration_id'])\
            .order('created_at', desc=True).limit(5).execute()
        if all_logs_res.data:
            for l_row in all_logs_res.data:
                st = str(l_row.get('logged_status', '')).strip().lower()
                has_in = bool(l_row.get('check_in'))
                has_out = bool(l_row.get('check_out'))
                # Active entry: checked in, not checked out, and not explicitly exited/denied
                if (has_in and not has_out) or st in ('inside', 'inside_campus'):
                    if st not in ('exited', 'exit', 'denied', 'exited_campus'):
                        open_cross_log = l_row
                        break
    except Exception as e:
        print(f"DEBUG: Error checking multi-campus logs: {e}")
        open_cross_log = None

    # Simple logic: if QR code exists in database, it's REGISTERED
    side.logged_status = "REGISTERED"
    side.status_warning_pending = False

    # Populate driver and vehicle details for dashboard and display
    first_n = reg.get('first_name', '')
    last_n = reg.get('last_name', '')
    driver_name = f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A'
    role_name = (reg.get('role') or 'N/A').capitalize()
    v_plate = side.vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A'
    v_brand = side.vehicle_data.get('brand') or reg.get('brand') or 'N/A'
    v_type = side.vehicle_data.get('type') or reg.get('type') or 'N/A'
    v_color = side.vehicle_data.get('color') or ''
    full_brand = f"{v_brand} ({v_color})" if v_color else v_brand

    # Identify current campus and active checked-in campus
    current_gate, current_campus = get_campus_gate_and_name()
    current_campus_norm = normalize_campus_name(current_campus)

    # --- Multi-campus duplicate entry & wrong campus exit flagging ---
    if open_cross_log:
        active_campus_norm = normalize_campus_name(open_cross_log.get('campus'))
        check_in_time = open_cross_log.get('check_in', '')
        try:
            dt = datetime.fromisoformat(check_in_time.replace('Z', '+00:00'))
            check_in_time = dt.strftime('%I:%M %p')
        except:
            pass

        # Case 1: ENTRANCE CAMERA (side.type == 'in')
        if side.type == 'in':
            if active_campus_norm != current_campus_norm:
                side.anomaly_desc = f"DOUBLE ACCESS: Currently checked in at {active_campus_norm.upper()} (at {check_in_time})! Cannot enter {current_campus_norm.upper()}."
                reason_text = f"Double Access: Currently checked in at {active_campus_norm}, attempted entry at {current_campus_norm}"
            else:
                side.anomaly_desc = f"DOUBLE ACCESS: Vehicle already INSIDE {current_campus_norm.upper()} (Entered at {check_in_time})!"
                reason_text = f"Double Access: Vehicle already inside {current_campus_norm}"

            # Log the flagged violation to database
            try:
                supabase.table('vehicle_log').insert({
                    "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id') or 1,
                    "registration_id": reg['registration_id'],
                    "check_in": datetime.now().isoformat(),
                    "check_out": datetime.now().isoformat(),
                    "logged_status": "denied",
                    "sticker_status": "registered",
                    "campus_gate": current_gate,
                    "campus": current_campus_norm,
                    "flagged_alert": "double_access",
                    "reason": reason_text
                }).execute()
            except Exception as err:
                print(f"DEBUG: Error logging double access violation: {err}")

            latest_scanned_details = {
                "gate": "ENTRANCE",
                "name": driver_name,
                "role": role_name,
                "plate": v_plate,
                "brand": full_brand,
                "type": v_type,
                "status": "FLAGGED (DOUBLE ACCESS)",
                "time": datetime.now().strftime("%I:%M:%S %p")
            }

            side.anomaly_id = open_cross_log.get('vehicle_log_id')
            side.state = GateState.LOG_WARNING
            return

        # Case 2: EXIT CAMERA (side.type == 'out')
        elif side.type == 'out':
            if active_campus_norm != current_campus_norm:
                side.anomaly_desc = f"WRONG CAMPUS EXIT VIOLATION: Checked in at {active_campus_norm.upper()} (at {check_in_time})! Cannot exit from {current_campus_norm.upper()}."
                reason_text = f"Exited the wrong campus: Checked in at {active_campus_norm}, attempted exit at {current_campus_norm}"

                # Log the flagged violation to database
                try:
                    supabase.table('vehicle_log').insert({
                        "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id') or 1,
                        "registration_id": reg['registration_id'],
                        "check_in": datetime.now().isoformat(),
                        "check_out": datetime.now().isoformat(),
                        "logged_status": "denied",
                        "sticker_status": "registered",
                        "campus_gate": current_gate,
                        "campus": current_campus_norm,
                        "flagged_alert": "wrong_campus_exit",
                        "reason": reason_text
                    }).execute()
                except Exception as err:
                    print(f"DEBUG: Error logging wrong campus exit violation: {err}")

                latest_scanned_details = {
                    "gate": "EXIT",
                    "name": driver_name,
                    "role": role_name,
                    "plate": v_plate,
                    "brand": full_brand,
                    "type": v_type,
                    "status": "FLAGGED (WRONG CAMPUS EXIT)",
                    "time": datetime.now().strftime("%I:%M:%S %p")
                }

                side.anomaly_id = open_cross_log.get('vehicle_log_id')
                side.state = GateState.LOG_WARNING
                return
            else:
                print(f"DEBUG: Active entry confirmed at {current_campus_norm}, proceeding with exit")

    elif side.type == 'out' and not open_cross_log:
        print(f"[{side.type}] No active entry record found, allowing exit anyway")

    latest_scanned_details = {
        "gate": "ENTRANCE" if side.type == 'in' else "EXIT",
        "name": driver_name,
        "role": role_name,
        "plate": v_plate,
        "brand": full_brand,
        "type": v_type,
        "status": side.logged_status or "REGISTERED",
        "time": datetime.now().strftime("%I:%M:%S %p")
    }

    # --- EXIT GATE: Auto-open for valid QR codes ---
    if side.type == 'out' and auto_exit:
        print(f"DEBUG: Exit gate - auto-opening for valid QR")
        submit_entry_exit(side)
        return

    # --- Entrance gate: valid QR codes go to DETECTED state (REGISTERED) ---
    side.state = GateState.DETECTED

def process_qr(side, qr_text, frame):
    global latest_scanned_details
    try:
        # Wait 1 second before capturing snapshot so the QR is fully in frame
        time.sleep(1)
        side.snapshot = frame.copy()
        
        # Look up registration by qr_code or qr_unique_code in Supabase
        try:
            response = supabase.table('registration').select('*').eq('qr_code', qr_text).execute()
            if not response.data:
                response = supabase.table('registration').select('*').eq('qr_unique_code', qr_text).execute()
            
            if not response.data:
                side.state = GateState.INVALID_QR
                side.data = qr_text
                return
            
            evaluate_registered_vehicle(side, response.data[0])

        except Exception as e:
            side.state = GateState.API_ERROR
            side.api_error = f"Supabase lookup error: {str(e)}"
            side.snapshot = frame.copy()
            
    except Exception as e:
        side.state = GateState.API_ERROR
        side.api_error = str(e)
        side.snapshot = frame.copy()

def lookup_registered_plate(side, plate_input):
    """Manual access for registered vehicles: the guard types a PLATE NUMBER or a REG. NO.
    The registration found goes through the exact same checks as a scanned QR (blocklist,
    parking limits, duplicate entry, wrong campus exit), ending on LET IN / DENY."""
    try:
        clean_input = re.sub(r'[\s\-]', '', plate_input).upper()
        # "REG 1042" / "REG1042" means a registration number only
        reg_only = re.fullmatch(r'REG\.?(?:NO\.?)?(\d+)', clean_input)
        if reg_only:
            plate_input = reg_only.group(1)
            clean_input = plate_input
        reg = None
        matched_vehicle_data = {}

        def _active(rows):
            # Prefer an active application; otherwise return the latest one so the gate can say why
            # it is denied (REVOKED / NOT REGISTERED) instead of "not found"
            rows = rows or []
            active = [r for r in rows if str(r.get('status') or '').lower() not in ('rejected', 'revoked')]
            return active or rows[:1]

        # 1. Match vehicle_information.plate_number, ignoring spaces and hyphens
        v_res = supabase.table('vehicle_information').select('*').execute() if not reg_only else _EmptyResponse()
        for v_item in (v_res.data or []):
            p_raw = str(v_item.get('plate_number') or '').strip().upper()
            if re.sub(r'[\s\-]', '', p_raw) != clean_input:
                continue
            r_res = supabase.table('registration').select('*')\
                .eq('vehicle_information_id', v_item['vehicle_information_id'])\
                .order('created_at', desc=True).execute()
            candidates = _active(r_res.data)
            if candidates:
                reg = candidates[0]
                matched_vehicle_data = v_item
                break

        # 2. Registration number (digits only, or typed as "REG 1042")
        if not reg and plate_input.isdigit():
            r_res = supabase.table('registration').select('*').eq('registration_id', int(plate_input)).execute()
            candidates = _active(r_res.data)
            if candidates:
                reg = candidates[0]

        if not reg:
            side.data = f"NOT FOUND: no active registration with plate or Reg. No. '{plate_input}'"
            side.state = GateState.INVALID_QR
            return

        if side.snapshot is None:
            side.snapshot = np.zeros((H//2, W, 3), dtype=np.uint8)
        evaluate_registered_vehicle(side, reg, matched_vehicle_data, auto_exit=False)
    except Exception as e:
        side.state = GateState.API_ERROR
        side.api_error = f"Lookup failed: {str(e)}"

def submit_entry_exit(side):
    print(f"DEBUG: submit_entry_exit called for {side.type} gate")
    print(f"DEBUG: side.data: {side.data}")
    print(f"DEBUG: side.data type: {type(side.data)}")
    
    # Validate that side.data exists and has required fields
    if side.data is None:
        print(f"DEBUG: ERROR - side.data is None")
        side.state = GateState.API_ERROR
        side.api_error = "No vehicle data available"
        return
    
    if not isinstance(side.data, dict):
        print(f"DEBUG: ERROR - side.data is not a dictionary: {type(side.data)}")
        side.state = GateState.API_ERROR
        side.api_error = "Invalid vehicle data format"
        return
    
    if 'registration_id' not in side.data:
        print(f"DEBUG: ERROR - registration_id not in side.data")
        side.state = GateState.API_ERROR
        side.api_error = "Missing registration ID"
        return
    
    side.state = GateState.PROCESSING
    
    def _run():
        action = 'entry' if side.type == 'in' else 'exit'
        current_time = datetime.now().isoformat()
        reg_id = side.data['registration_id']
        
        try:
            gate_enum, norm_campus_name = get_campus_gate_and_name()
            if side.type == 'out':
                # EXIT: Close any open entry logs in vehicle_log where check_out is null
                side.scan_cooldown_end = time.time() + 5.0
                side.prolong_ready_time = time.time() + 5.0
                exit_flag = getattr(side, 'exit_flag', None)
                flag_fields = {"flagged_alert": exit_flag[0], "reason": exit_flag[1]} if exit_flag else {}
                try:
                    all_logs = supabase.table('vehicle_log').select('vehicle_log_id, check_out').eq('registration_id', reg_id).execute()
                    open_rows = [r for r in (all_logs.data or []) if not r.get('check_out')]
                    if open_rows:
                        for row in open_rows:
                            supabase.table('vehicle_log').update({
                                "check_out": current_time,
                                "logged_status": "exited_campus",
                                **flag_fields
                            }).eq('vehicle_log_id', row['vehicle_log_id']).execute()
                        print(f"DEBUG: Closed {len(open_rows)} open vehicle_log row(s) on exit")
                    else:
                        # Fallback: create standalone exit log
                        log_data = {
                            "vehicle_information_id": side.data.get('vehicle_information_id') or 1,
                            "registration_id": reg_id,
                            "check_in": current_time,
                            "check_out": current_time,
                            "logged_status": "exited_campus",
                            "sticker_status": "registered",
                            "campus_gate": gate_enum,
                            "campus": norm_campus_name,
                            **flag_fields
                        }
                        supabase.table('vehicle_log').insert(log_data).execute()
                        print(f"DEBUG: Standalone exit log created")
                except Exception as e:
                    print(f"DEBUG: Error updating exit log: {e}")
            else:
                # ENTRY: Insert new vehicle_log with check_out = None
                log_data = {
                    "vehicle_information_id": side.data.get('vehicle_information_id') or 1,
                    "registration_id": reg_id,
                    "check_in": current_time,
                    "check_out": None,
                    "logged_status": "inside_campus",
                    "sticker_status": "registered",
                    "campus_gate": gate_enum,
                    "campus": norm_campus_name
                }
                supabase.table('vehicle_log').insert(log_data).execute()
                print(f"DEBUG: Entry log submitted successfully")
            
            # Add to global logs table in UI
            driver_name = side.data.get('first_name', '') + ' ' + side.data.get('last_name', '')
            driver_name = driver_name.strip() or side.data.get('name', 'User')
            v_plate = side.vehicle_data.get('plate_number') or side.data.get('plate_number') or 'N/A'
            global global_logs
            global_logs.insert(0, {
                "time": datetime.now().strftime("%H:%M:%S"),
                "bound": "IN" if side.type == 'in' else "OUT",
                "name": driver_name[:12],
                "plate": v_plate[:10]
            })

            # Re-sync parking availability and currentlyIn counts in database
            sync_parking_availability()
            refresh_parking_data()

            # Open gate with 15-second countdown
            open_gate(side)
        except Exception as e:
            print(f"DEBUG: Error submitting {action} log: {type(e).__name__}: {e}")
            side.state = GateState.API_ERROR
            side.api_error = f"Submit failed: {str(e)}"
            
    threading.Thread(target=_run, daemon=True).start()

_placeholder_ids = None

def get_placeholder_ids():
    """Find an existing registration row (registration_id, vehicle_information_id)
    to attach VIP/guest logs to, since vehicle_log requires valid foreign keys."""
    global _placeholder_ids
    if _placeholder_ids:
        return _placeholder_ids
    try:
        r = supabase.table('registration').select('registration_id, vehicle_information_id').order('registration_id').limit(1).execute()
        if r.data:
            _placeholder_ids = (r.data[0]['registration_id'], r.data[0]['vehicle_information_id'])
            print(f"DEBUG: Using placeholder IDs for VIP/guest logs: {_placeholder_ids}")
            return _placeholder_ids
        print("DEBUG: No registration rows exist - cannot attach VIP/guest log")
    except Exception as e:
        print(f"DEBUG: Error finding placeholder IDs: {e}")
    return None

def submit_vip(side):
    side.state = GateState.PROCESSING
    def _run():
        current_time = datetime.now().isoformat()
        
        try:
            ids = get_placeholder_ids()
            placeholder_reg_id, placeholder_vehicle_id = ids if ids else (None, None)

            gate_enum, norm_campus_name = get_campus_gate_and_name()
            if side.type == 'out':
                # VIP EXIT: Find open VIP record in vehicle_log and close it
                target_log_id = None
                try:
                    all_campus_logs = supabase.table('vehicle_log').select('*')\
                        .ilike('campus', f"%{norm_campus_name}%")\
                        .order('created_at', desc=True).limit(30).execute()
                    
                    open_vip_logs = [r for r in (all_campus_logs.data or []) if not r.get('check_out')]
                    if open_vip_logs:
                        for row in open_vip_logs:
                            st = str(row.get('logged_status', '')).lower()
                            if row.get('vip_access') or row.get('is_vip') or 'vip' in st:
                                target_log_id = row['vehicle_log_id']
                                break
                        if not target_log_id and open_vip_logs:
                            target_log_id = open_vip_logs[0]['vehicle_log_id']

                    if target_log_id:
                        supabase.table('vehicle_log').update({
                            "check_out": current_time,
                            "logged_status": "exited_campus"
                        }).eq('vehicle_log_id', target_log_id).execute()
                        print(f"DEBUG: Closed open VIP vehicle_log row {target_log_id} on exit")
                    else:
                        log_data = {
                            "vehicle_information_id": placeholder_vehicle_id,
                            "registration_id": placeholder_reg_id,
                            "check_in": current_time,
                            "check_out": current_time,
                            "logged_status": "exited_campus",
                            "sticker_status": "unregistered",
                            "vip_access": True,
                            "campus_gate": gate_enum,
                            "campus": norm_campus_name,
                            "reason": "VIP Access"
                        }
                        supabase.table('vehicle_log').insert(log_data).execute()
                except Exception as e:
                    print(f"DEBUG: Error processing VIP exit: {e}")
            else:
                # VIP ENTRY: Log directly into vehicle_log with vip_access = True
                log_data = {
                    "vehicle_information_id": placeholder_vehicle_id,
                    "registration_id": placeholder_reg_id,
                    "check_in": current_time,
                    "check_out": None,
                    "logged_status": "inside_campus",
                    "sticker_status": "unregistered",
                    "vip_access": True,
                    "campus_gate": gate_enum,
                    "campus": norm_campus_name,
                    "reason": "VIP Access"
                }
                supabase.table('vehicle_log').insert(log_data).execute()
                print(f"DEBUG: Logged VIP entry in vehicle_log for {norm_campus_name}")

            global latest_scanned_details
            latest_scanned_details = {
                "gate": "EXIT" if side.type == "out" else "ENTRANCE",
                "name": "VIP Guest",
                "role": "VIP",
                "plate": "VIP",
                "brand": "VIP Access",
                "type": "VIP Vehicle",
                "status": "EXITED CAMPUS" if side.type == "out" else "INSIDE CAMPUS",
                "time": datetime.now().strftime("%I:%M:%S %p")
            }

            sync_parking_availability()
            refresh_parking_data()
        except Exception as e:
            print(f"DEBUG: VIP logging failed: {type(e).__name__}: {e}")
        
        open_gate(side)

    threading.Thread(target=_run, daemon=True).start()

def check_and_submit_guest(side):
    """Check for guest anomaly before submitting. Shows GUEST_WARNING if found."""
    # Anomaly checks for guests are disabled. Submit directly.
    submit_manual_guest(side)

def submit_manual_guest(side):
    side.state = GateState.PROCESSING
    
    def _run():
        global latest_scanned_details
        current_time = datetime.now().isoformat()
        
        try:
            if side.type == 'in':
                plate_val = side.form_data[0][:15].strip() or "GUEST"
                id_val = side.form_data[1][:50].strip() or "N/A"
                purpose_val = side.form_data[2].strip() or "Visitor"
                try:
                    guest_data = {
                        "plate_number": plate_val,
                        "id_number": id_val,
                        "purpose": purpose_val,
                        "timestamp": current_time
                    }
                    
                    guest_result = supabase.table('guest').insert(guest_data).execute()
                    guest_id = guest_result.data[0]['guest_id'] if guest_result.data else None

                    gate_enum, norm_campus_name = get_campus_gate_and_name()
                    log_data = {
                        "guest_id": guest_id,
                        "check_in": current_time,
                        "check_out": None,
                        "logged_status": "inside_campus",
                        "sticker_status": "unregistered",
                        "campus_gate": gate_enum,
                        "campus": norm_campus_name
                    }
                    
                    vehicle_log_result = supabase.table('vehicle_log').insert(log_data).execute()
                    sync_parking_availability()
                    refresh_parking_data()

                    latest_scanned_details = {
                        "gate": "ENTRANCE",
                        "name": f"Guest (ID: {id_val})",
                        "role": "Guest",
                        "plate": plate_val,
                        "brand": purpose_val,
                        "type": "Guest Vehicle",
                        "status": "INSIDE CAMPUS",
                        "time": datetime.now().strftime("%I:%M:%S %p")
                    }
                except Exception as e:
                    # Logging failed, but the guest must still be let in
                    print(f"DEBUG: Guest logging failed (opening gate anyway): {type(e).__name__}: {e}")
                
                # Open gate automatically with 10 seconds delay (direct servo control)
                servo = servo_in if side.type == 'in' else servo_out
                set_servo_angle(servo, 90)
                side.state = GateState.TIMEOUT
                side.timeout_end = time.time() + 10  # 10 seconds countdown for guest operations
                print(f"DEBUG: Guest gate opened, 10-second countdown started")
            else:
                # Guest exit - find guest by plate and update
                plate_number = side.form_data[0].strip()
                exit_time = datetime.now().isoformat()
                
                # Find the guest entries
                guest_response = supabase.table('guest').select('*').eq('plate_number', plate_number).order('timestamp', desc=True).limit(5).execute()
                
                active_guest = None
                active_vlog_id = None
                if guest_response.data:
                    for candidate in guest_response.data:
                        gid = candidate.get('guest_id')
                        vlog_resp = supabase.table('vehicle_log').select('*').eq('guest_id', gid).is_('check_out', 'null').order('check_in', desc=True).limit(1).execute()
                        if vlog_resp.data and len(vlog_resp.data) > 0:
                            active_guest = candidate
                            active_vlog_id = vlog_resp.data[0].get('vehicle_log_id')
                            break

                if active_guest and active_vlog_id:
                    print(f"DEBUG: Updating guest exit for vehicle_log_id: {active_vlog_id}")
                    supabase.table('vehicle_log').update({"check_out": exit_time, "logged_status": "exited_campus"}).eq('vehicle_log_id', active_vlog_id).execute()
                    sync_parking_availability()
                    refresh_parking_data()
                    latest_scanned_details = {
                        "gate": "EXIT",
                        "name": f"Guest (ID: {active_guest.get('id_number', 'N/A')})",
                        "role": "Guest",
                        "plate": plate_number or "N/A",
                        "brand": active_guest.get('purpose', 'Guest Exit'),
                        "type": "Guest Vehicle",
                        "status": "EXITED CAMPUS",
                        "time": datetime.now().strftime("%I:%M:%S %p")
                    }
                    
                    # Open gate with 10 seconds delay (direct servo control)
                    servo = servo_in if side.type == 'in' else servo_out
                    set_servo_angle(servo, 90)
                    side.state = GateState.TIMEOUT
                    side.timeout_end = time.time() + 10  # 10 seconds countdown for guest operations
                    print(f"DEBUG: Guest exit gate opened, 10-second countdown started")
                else:
                    side.state = GateState.API_ERROR
                    side.api_error = "Guest not found or already checked out"
                
        except Exception as e:
            side.state = GateState.API_ERROR
            side.api_error = f"Manual submit failed: {str(e)}"
            
    threading.Thread(target=_run, daemon=True).start()

def search_guest(side):
    """Search for guest by plate number"""
    search_term = side.form_data[0].strip()
    if not search_term:
        side.state = GateState.API_ERROR
        side.api_error = "Search term cannot be empty"
        return
    
    side.state = GateState.PROCESSING
    
    def _run():
        try:
            # Search guest table by plate number in Supabase
            response = supabase.table('guest').select('*').eq('plate_number', search_term).order('timestamp', desc=True).limit(5).execute()
            
            if response.data and len(response.data) > 0:
                active_guest = None
                active_vlog_id = None
                for candidate in response.data:
                    gid = candidate.get('guest_id')
                    vlog_resp = supabase.table('vehicle_log').select('*').eq('guest_id', gid).is_('check_out', 'null').order('check_in', desc=True).limit(1).execute()
                    if vlog_resp.data and len(vlog_resp.data) > 0:
                        active_guest = candidate
                        active_vlog_id = vlog_resp.data[0].get('vehicle_log_id')
                        break
                
                if active_guest and active_vlog_id:
                    side.data = {
                        'plate': active_guest.get('plate_number'),
                        'id_number': active_guest.get('id_number'),
                        'purpose': active_guest.get('purpose'),
                        'timestamp': active_guest.get('timestamp'),
                        'vehicle_log_id': active_vlog_id
                    }
                    side.state = GateState.MANUAL_GUEST_SEARCH_RESULT
                else:
                    side.state = GateState.API_ERROR
                    side.api_error = "Guest already checked out or no active check-in found"
            else:
                side.state = GateState.API_ERROR
                side.api_error = "No guest found"
        except Exception as e:
            side.state = GateState.API_ERROR
            side.api_error = f"Search failed: {str(e)}"
    
    threading.Thread(target=_run, daemon=True).start()

def submit_guest_exit(side):
    """Submit guest exit and automatically open gate with 10 seconds delay"""
    if not side.data:
        side.state = GateState.API_ERROR
        side.api_error = "No guest data available"
        return
    
    side.state = GateState.PROCESSING
    
    def _run():
        exit_time = datetime.now().isoformat()
        vehicle_log_id = side.data.get('vehicle_log_id')
        
        try:
            # Update vehicle log with checkout time and status Exited
            if vehicle_log_id:
                supabase.table('vehicle_log').update({"check_out": exit_time, "logged_status": "exited_campus"}).eq('vehicle_log_id', vehicle_log_id).execute()
                sync_parking_availability()
                refresh_parking_data()
                
                global latest_scanned_details
                latest_scanned_details = {
                    "gate": "EXIT",
                    "name": f"Guest (ID: {side.data.get('id_number', 'N/A')})",
                    "role": "Guest",
                    "plate": side.data.get('plate', 'N/A'),
                    "brand": side.data.get('purpose', 'Guest Exit'),
                    "type": "Guest Vehicle",
                    "status": "EXITED CAMPUS",
                    "time": datetime.now().strftime("%I:%M:%S %p")
                }

                # Open gate with 10 seconds delay (direct servo control for guest operations)
                servo = servo_in if side.type == 'in' else servo_out
                set_servo_angle(servo, 90)
                side.state = GateState.TIMEOUT
                side.timeout_end = time.time() + 10  # 10 seconds countdown for guest operations
                print(f"DEBUG: Guest exit gate opened, 10-second countdown started")
            else:
                side.state = GateState.API_ERROR
                side.api_error = "Invalid vehicle log ID"
        except Exception as e:
            side.state = GateState.API_ERROR
            side.api_error = f"Exit failed: {str(e)}"
    
    threading.Thread(target=_run, daemon=True).start()

from pyzbar.pyzbar import decode, ZBarSymbol

# ==============================================================================
# UI RENDERING & MOUSE
# ==============================================================================
W, H = 1280, 720

# Search for the first two valid cameras
# Many USB cameras create two /dev/video nodes (video + metadata).
# We must try reading a frame to ensure it's a usable video node.
print("DEBUG: Startup - Probing for cameras (this might take a while if cameras hang)...")
available_caps = []
for i in range(20): # Probe first 20 indices (Raspberry Pi often uses 10+ for USB cams)
    print(f"DEBUG: Startup - Probing camera index {i}...")
    cap = cv2.VideoCapture(i)
    if cap.isOpened():
        ret, _ = cap.read()
        if ret:
            available_caps.append(cap)
            if len(available_caps) == 2:
                break
        else:
            cap.release()
    else:
        cap.release()

print(f"DEBUG: Startup - Finished probing. Found {len(available_caps)} valid cameras.")
cap1 = available_caps[0] if len(available_caps) > 0 else None
has_cam1 = cap1.isOpened() if cap1 else False
if has_cam1:
    cap1.set(cv2.CAP_PROP_FRAME_WIDTH, W // 2)
    cap1.set(cv2.CAP_PROP_FRAME_HEIGHT, H // 2)

cap2 = available_caps[1] if len(available_caps) > 1 else None
if cap2 and cap2.isOpened():
    cap2.set(cv2.CAP_PROP_FRAME_WIDTH, W // 2)
    cap2.set(cv2.CAP_PROP_FRAME_HEIGHT, H // 2)
    has_dual_cam = True
else:
    has_dual_cam = False
    if cap2:
        cap2.release()

# Helpers for drawing
def apply_zoom(frame, zoom_factor):
    if zoom_factor <= 1.0 or frame is None:
        return frame
    
    h, w = frame.shape[:2]
    new_h, new_w = int(h / zoom_factor), int(w / zoom_factor)
    
    y1 = (h - new_h) // 2
    y2 = y1 + new_h
    x1 = (w - new_w) // 2
    x2 = x1 + new_w
    
    cropped = frame[y1:y2, x1:x2]
    return cv2.resize(cropped, (w, h))

def draw_text(img, text, pos, scale=0.6, color=(255,255,255), thick=1):
    cv2.putText(img, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick)

def draw_btn(img, rect, text, bg_color=(50,200,50)):
    x1, y1, w, h = rect
    cv2.rectangle(img, (x1, y1), (x1+w, y1+h), bg_color, -1)
    draw_text(img, text, (x1+10, y1+30), 0.7, (255,255,255), 2)

def in_rect(x, y, rect):
    rx, ry, rw, rh = rect
    return rx <= x <= rx+rw and ry <= y <= ry+rh

def render_guest_entry_bottom(img, side):
    """Render guest entry fill out form in card box on cream background"""
    box_x = 520
    box_y = H//2 + 15
    box_w = W - 25 - box_x
    box_h = H - 20 - box_y
    
    cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h), (255, 255, 255), -1)
    cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h), (195, 205, 210), 2)
    
    campus_name = (SELECTED_CAMPUS or 'CAMPUS').upper()
    
    if side.state == GateState.MANUAL_GUEST_CONFIRM:
        cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + 48), (240, 245, 248), -1)
        draw_text(img, f"{campus_name} - CONFIRM GUEST ENTRY", (box_x + 20, box_y + 34), 0.78, (35, 40, 50), 2)
        draw_text(img, "Please review details before granting access:", (box_x + 25, box_y + 80), 0.60, (70, 75, 85), 1)
        
        plate_str = side.form_data[0] if side.form_data[0] else 'N/A'
        id_str = side.form_data[1] if side.form_data[1] else 'N/A'
        purp_str = side.form_data[2] if side.form_data[2] else 'N/A'
        
        draw_text(img, f"Plate Number : {plate_str}", (box_x + 35, box_y + 120), 0.72, (20, 25, 35), 2)
        draw_text(img, f"ID Number    : {id_str}", (box_x + 35, box_y + 155), 0.72, (20, 25, 35), 2)
        draw_text(img, f"Purpose      : {purp_str}", (box_x + 35, box_y + 190), 0.72, (180, 70, 20), 2)
        
        draw_btn(img, (box_x + 35, box_y + 240, 180, 48), "GRANT ACCESS", (40, 160, 60))
        draw_btn(img, (box_x + 235, box_y + 240, 140, 48), "BACK / EDIT", (140, 60, 60))
    else:
        # MANUAL_GUEST_IN
        cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + 48), (240, 245, 248), -1)
        draw_text(img, f"{campus_name} - GUEST REGISTRATION", (box_x + 20, box_y + 34), 0.78, (35, 40, 50), 2)
        draw_text(img, "Fill out guest information to grant entry:", (box_x + 25, box_y + 72), 0.58, (80, 85, 95), 1)
        
        labels = ["Plate Number:", "ID Number:", "Purpose:"]
        for idx in range(3):
            y_base = box_y + 85 + idx * 48
            is_active = (side.input_field == idx)
            label_col = (180, 70, 20) if is_active else (50, 55, 65)
            box_border = (40, 160, 60) if is_active else (190, 200, 205)
            box_bg = (245, 250, 245) if is_active else (250, 250, 252)
            
            draw_text(img, labels[idx], (box_x + 25, y_base + 26), 0.65, label_col, 2 if is_active else 1)
            cv2.rectangle(img, (box_x + 180, y_base), (box_x + 530, y_base + 38), box_bg, -1)
            cv2.rectangle(img, (box_x + 180, y_base), (box_x + 530, y_base + 38), box_border, 2 if is_active else 1)
            
            val_text = side.form_data[idx] + ("_" if is_active else "")
            draw_text(img, val_text, (box_x + 190, y_base + 26), 0.68, (20, 25, 35), 2)
            
        draw_btn(img, (box_x + 180, box_y + 245, 150, 45), "CONFIRM", (40, 160, 60))
        draw_btn(img, (box_x + 350, box_y + 245, 130, 45), "CANCEL", (110, 110, 120))

def render_guest_exit_bottom(img, side):
    """Render guest exit search and verification form in card box on cream background"""
    box_x = 520
    box_y = H//2 + 15
    box_w = W - 25 - box_x
    box_h = H - 20 - box_y
    
    cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h), (255, 255, 255), -1)
    cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h), (195, 205, 210), 2)
    
    campus_name = (SELECTED_CAMPUS or 'CAMPUS').upper()
    
    if side.state == GateState.MANUAL_GUEST_SEARCH_RESULT:
        cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + 48), (240, 245, 248), -1)
        draw_text(img, f"{campus_name} - GUEST RECORD FOUND", (box_x + 20, box_y + 34), 0.78, (30, 130, 40), 2)
        draw_text(img, "Verified guest entry record:", (box_x + 25, box_y + 80), 0.60, (70, 75, 85), 1)
        
        if side.data:
            draw_text(img, f"Plate Number : {side.data.get('plate', 'N/A')}", (box_x + 35, box_y + 118), 0.72, (20, 25, 35), 2)
            draw_text(img, f"ID Number    : {side.data.get('id_number', 'N/A')}", (box_x + 35, box_y + 152), 0.72, (20, 25, 35), 2)
            draw_text(img, f"Purpose      : {side.data.get('purpose', 'N/A')}", (box_x + 35, box_y + 186), 0.72, (180, 70, 20), 2)
            entry_time = side.data.get('timestamp', 'N/A')
            if entry_time and entry_time != 'N/A':
                try:
                    dt = datetime.fromisoformat(entry_time.replace('Z', '+00:00'))
                    entry_time = dt.strftime('%I:%M %p')
                except:
                    pass
            draw_text(img, f"Check In     : {entry_time}", (box_x + 35, box_y + 218), 0.65, (40, 120, 40), 2)
            
        draw_btn(img, (box_x + 35, box_y + 245, 175, 48), "ALLOW EXIT", (40, 160, 60))
        draw_btn(img, (box_x + 235, box_y + 245, 130, 48), "CANCEL", (110, 110, 120))
    else:
        # MANUAL_GUEST_OUT
        cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + 48), (240, 245, 248), -1)
        draw_text(img, f"{campus_name} - GUEST EXIT SEARCH", (box_x + 20, box_y + 34), 0.78, (35, 40, 50), 2)
        draw_text(img, "Enter plate number to verify checked-in guest:", (box_x + 25, box_y + 75), 0.58, (80, 85, 95), 1)
        
        draw_text(img, "Plate Number:", (box_x + 25, box_y + 125), 0.68, (180, 70, 20), 2)
        cv2.rectangle(img, (box_x + 180, box_y + 98), (box_x + 530, box_y + 142), (250, 250, 252), -1)
        cv2.rectangle(img, (box_x + 180, box_y + 98), (box_x + 530, box_y + 142), (40, 160, 60), 2)
        
        draw_text(img, side.form_data[0] + "_", (box_x + 195, box_y + 128), 0.72, (20, 25, 35), 2)
        
        draw_btn(img, (box_x + 180, box_y + 175, 150, 48), "SEARCH", (40, 160, 60))
        draw_btn(img, (box_x + 350, box_y + 175, 130, 48), "CANCEL", (110, 110, 120))

def get_card_status(side):
    """(title, BGR color, info lines) shown in the SCANNED QR INFORMATION card for a gate state."""
    gate_name = "ENTRANCE" if side.type == 'in' else "EXIT"
    st = side.state
    now = time.time()

    if st == GateState.PROCESSING:
        return "PROCESSING...", (170, 90, 20), ["Looking up the vehicle record, please wait."]
    if st == GateState.SCANNING:
        if side.type == 'out' and now < getattr(side, 'scan_cooldown_end', 0):
            wait_s = max(1, int(side.scan_cooldown_end - now) + 1)
            return f"SCANNER COOLDOWN - READY IN {wait_s}s", (0, 120, 220), ["Please wait 5 seconds between exit scans."]
        return "READY TO SCAN", (20, 140, 30), [f"Hold the QR sticker in front of the {gate_name} camera."]
    if st == GateState.DETECTED:
        verb = "LET IN" if side.type == 'in' else "LET OUT"
        return f"REGISTERED - VERIFY, THEN {verb} OR DENY", (20, 140, 30), ["Check that the vehicle matches the details below."]
    if st == GateState.INVALID_QR:
        content = str(side.data or '')
        first = content if content.startswith("NOT FOUND") else f"QR content: {content[:45]}"
        return "INVALID QR CODE", (0, 0, 200), [first, "Not a recognized registration. Use OPEN MANUALLY or DISMISS."]
    if st == GateState.API_ERROR:
        return "CONNECTION / DATABASE ERROR", (0, 0, 200), [str(side.api_error or 'Unknown error')[:70], "Use OPEN MANUALLY or DISMISS."]
    if st == GateState.WARNING:
        return "ANOMALY WARNING", (0, 120, 220), [str(side.anomaly_desc or '')[:80]]
    if st == GateState.LOG_WARNING:
        title = "FLAGGED: WRONG CAMPUS EXIT" if side.type == 'out' else "FLAGGED: DOUBLE ACCESS"
        return title, (0, 0, 200), [str(side.anomaly_desc or '')[:80], "Violation logged. Security override required."]
    if st == GateState.TYPE_FULL:
        label = getattr(side, 'full_type_label', 'VEHICLE')
        used, cap = getattr(side, 'full_type_counts', (0, 0))
        return f"{label} PARKING FULL", (0, 0, 200), [f"{label} slots occupied: {used} / {cap}", "Override only if a slot is actually free."]
    if st == GateState.STATUS_DENIED:
        title, detail, status = getattr(side, 'denied_info', ("ENTRY DENIED", "", ""))
        lines = [detail[:80], detail[80:160], f"Application status: {status or 'UNKNOWN'}"]
        return f"{title} - ENTRY DENIED", (0, 0, 200), [l for l in lines if l]
    if st == GateState.BLOCKED:
        block = side.block_info or {}
        until_dt = parse_db_timestamp(block.get('blocked_until'))
        until_txt = until_dt.astimezone().strftime('%b %d, %Y %I:%M %p') if until_dt else 'N/A'
        by_txt = str(block.get('block_by') or 'N/A').replace('_', ' ').upper()
        return "BLOCKED - ENTRY DENIED", (0, 0, 200), [
            f"Time remaining: {format_remaining(block.get('blocked_until'))}  (until {until_txt})",
            f"Reason: {str(block.get('reason') or 'No reason given')[:60]}",
            f"Blocked by: {by_txt}",
        ]
    if st == GateState.TIMEOUT:
        rem = max(0, int(side.timeout_end - now))
        lines = []
        if side.type == 'out':
            if now < getattr(side, 'scan_cooldown_end', 0):
                lines.append(f"Exit logged. Next scan ready in {max(1, int(side.scan_cooldown_end - now) + 1)}s.")
            else:
                lines.append("Scan a QR to refresh the timer (5s between scans).")
        return f"GATE OPEN - CLOSING IN {rem}s", (20, 140, 30), lines
    if st == GateState.PROLONG:
        cd_end = max(getattr(side, 'scan_cooldown_end', 0), getattr(side, 'prolong_ready_time', 0))
        if now < cd_end:
            return "EXITED - DEPARTURE LOGGED", (20, 140, 30), [f"Scanner ready for the next vehicle in {max(1, int(cd_end - now) + 1)}s."]
        return "BARRIER OPEN (PROLONG)", (20, 140, 30), ["Scanning exit QR codes - 5 seconds between vehicles."]
    if st == GateState.CAMPUS_FULL:
        max_cap = global_stats.get('maxCapacity', -1)
        cap_str = str(max_cap) if max_cap != -1 else "No Limit"
        return "CAMPUS FULL", (0, 0, 200), [f"Capacity {cap_str}  |  Inside {global_stats.get('currentlyIn', 0)}  |  Available {global_stats.get('availableSlots', 0)}"]
    if st == GateState.MANUAL_TYPE:
        return "MANUAL ACCESS", (170, 90, 20), ["Choose REGISTERED ACCESS, GUEST or VIP ACCESS above."]
    if st == GateState.MANUAL_REG:
        return "MANUAL ACCESS - REGISTERED VEHICLE", (170, 90, 20), ["Type the PLATE NUMBER or REG. NO. on the keyboard, then LOOKUP."]
    if st == GateState.GUEST_WARNING:
        return "GUEST ANOMALY", (0, 120, 220), [str(side.anomaly_desc or '')[:80]]
    return str(st), (90, 95, 105), []

def render_bottom_panel(display):
    """Render full-width cream background bottom dashboard with campus capacity & scanned QR info box"""
    # Soft cream background
    display[H//2:H, 0:W] = CREAM_BG
    cv2.line(display, (0, H//2), (W, H//2), (205, 215, 220), 2)
    
    # -------------------------------------------------------------------------
    # LEFT SECTION: Campus Information & Vehicle Capacity Metrics (x: 25 -> 480)
    # -------------------------------------------------------------------------
    campus_name = (SELECTED_CAMPUS or 'CAMPUS').upper()
    event_name = global_stats.get('eventName', '').strip()
    if event_name:
        draw_text(display, f"{campus_name} CAMPUS - {event_name.upper()}", (30, H//2 + 42), 0.82, (120, 40, 10), 2)
    else:
        draw_text(display, f"{campus_name} CAMPUS", (30, H//2 + 42), 0.95, (120, 40, 10), 2)
        
    cv2.line(display, (30, H//2 + 62), (480, H//2 + 62), (195, 205, 210), 2)
    
    max_cap = global_stats.get('maxCapacity', -1)
    cap_str = str(max_cap) if max_cap != -1 else "200"
    currently_in = global_stats.get('currentlyIn', 0)
    available_slots = global_stats.get('availableSlots', max(0, (max_cap if max_cap != -1 else 200) - currently_in))
    
    draw_text(display, f"Total Capacity : {cap_str}", (30, H//2 + 100), 0.78, (45, 45, 45), 2)
    draw_text(display, f"Occupied (IN)  : {currently_in}", (30, H//2 + 140), 0.78, (20, 130, 30), 2)
    draw_text(display, f"Unoccupied     : {available_slots}", (30, H//2 + 180), 0.78, (180, 70, 20), 2)
    
    cap2_txt = global_stats.get('cap2') if global_stats.get('cap2') is not None else '-'
    cap4_txt = global_stats.get('cap4') if global_stats.get('cap4') is not None else '-'
    draw_text(display, f"2W: {global_stats.get('in2', 0)}/{cap2_txt}   4W: {global_stats.get('in4', 0)}/{cap4_txt}", (30, H//2 + 212), 0.66, (70, 75, 85), 2)

    view_label = "ACTIVE: ENTRANCE CAMERA" if CURRENT_VIEW == 'in' else "ACTIVE: EXIT CAMERA"
    draw_text(display, view_label, (30, H//2 + 245), 0.6, (90, 95, 105), 2)
    
    draw_btn(display, (30, H - 65, 120, 42), "REFRESH", (50, 150, 200))
    if side_in.state == GateState.SCANNING and side_out.state in (GateState.SCANNING, GateState.PROLONG):
        draw_btn(display, (165, H - 65, 120, 42), "BACK", (110, 110, 120))
        
    # Vertical separator
    cv2.line(display, (500, H//2 + 15), (500, H - 15), (200, 210, 215), 2)

    # -------------------------------------------------------------------------
    # RIGHT SECTION: Guest Form Active OR Scanned QR Information Box (x: 520 -> W - 25)
    # -------------------------------------------------------------------------
    if side_in.state in (GateState.MANUAL_GUEST_IN, GateState.MANUAL_GUEST_CONFIRM):
        render_guest_entry_bottom(display, side_in)
        return
        
    if side_out.state in (GateState.MANUAL_GUEST_OUT, GateState.MANUAL_GUEST_SEARCH_RESULT):
        render_guest_exit_bottom(display, side_out)
        return
        
    # Scanned QR Information Card Box
    box_x = 520
    box_y = H//2 + 15
    box_w = W - 25 - box_x
    box_h = H - 20 - box_y
    
    cv2.rectangle(display, (box_x, box_y), (box_x + box_w, box_y + box_h), (255, 255, 255), -1)
    cv2.rectangle(display, (box_x, box_y), (box_x + box_w, box_y + box_h), (195, 205, 210), 2)
    
    # Card Header
    cv2.rectangle(display, (box_x, box_y), (box_x + box_w, box_y + 48), (240, 245, 248), -1)
    cv2.rectangle(display, (box_x, box_y), (box_x + box_w, box_y + 48), (195, 205, 210), 1)
    draw_text(display, "SCANNED QR INFORMATION", (box_x + 20, box_y + 34), 0.78, (35, 40, 50), 2)

    # Status of the camera currently shown (title + up to three info lines)
    active = side_in if CURRENT_VIEW == 'in' else side_out
    title, title_col, info_lines = get_card_status(active)
    draw_text(display, title, (box_x + 20, box_y + 80), 0.74, title_col, 2)
    y = box_y + 108
    if active.state == GateState.MANUAL_REG:
        cv2.rectangle(display, (box_x + 20, y - 4), (box_x + 420, y + 34), (245, 250, 245), -1)
        cv2.rectangle(display, (box_x + 20, y - 4), (box_x + 420, y + 34), (40, 160, 60), 2)
        draw_text(display, (active.form_data[0] or '') + "_", (box_x + 30, y + 24), 0.75, (20, 25, 35), 2)
        y += 64
    for line in info_lines[:3]:
        draw_text(display, line, (box_x + 20, y), 0.58, (60, 65, 75), 1)
        y += 24
        
    # If the barrier is closed, the scanned QR code details display will disappear
    barrier_open_or_active = (
        side_in.state in (GateState.TIMEOUT, GateState.PROLONG, GateState.DETECTED, GateState.PROCESSING, GateState.LOG_WARNING, GateState.WARNING, GateState.BLOCKED, GateState.TYPE_FULL, GateState.STATUS_DENIED) or
        side_out.state in (GateState.TIMEOUT, GateState.PROLONG, GateState.DETECTED, GateState.PROCESSING, GateState.LOG_WARNING, GateState.WARNING, GateState.BLOCKED, GateState.TYPE_FULL)
    )
    global latest_scanned_details
    if not barrier_open_or_active:
        latest_scanned_details = None

    # Vehicle details of the last scan / lookup
    cv2.line(display, (box_x + 20, y - 8), (box_x + box_w - 20, y - 8), (225, 230, 235), 1)
    y += 18
    if latest_scanned_details:
        d = latest_scanned_details
        draw_text(display, f"Name: {d.get('name', 'N/A')}   |   Role: {d.get('role', 'N/A')}", (box_x + 20, y), 0.68, (20, 25, 35), 2)
        draw_text(display, f"Plate: {d.get('plate', 'N/A')}   |   Type: {d.get('type', 'N/A')}", (box_x + 20, y + 30), 0.68, (170, 60, 20), 2)
        draw_text(display, f"Vehicle: {d.get('brand', 'N/A')}", (box_x + 20, y + 58), 0.62, (40, 45, 55), 1)
        draw_text(display, f"[{d.get('gate', 'GATE')}] {d.get('time', '')}   Status: {d.get('status', '')}", (box_x + 20, y + 84), 0.56, (90, 95, 105), 1)
    else:
        draw_text(display, "No vehicle scanned yet - details will appear here.", (box_x + 20, y), 0.6, (120, 125, 135), 1)

def render_side(img, side, offset_x=0):
    """Camera feed overlay: only buttons (and the scan line). Every message and vehicle detail
    is shown in the SCANNED QR INFORMATION card below the feed."""
    # Top-right View Toggle Button
    if CURRENT_VIEW == 'in':
        draw_btn(img, (W - 210, 15, 190, 42), "Exit Camera >", (50, 150, 220))
    else:
        draw_btn(img, (W - 245, 15, 225, 42), "< Entrance Camera", (50, 150, 220))

    if side.state == GateState.SCANNING:
        # Full-width laser line
        cycle_duration = 3.0
        t = (time.time() + side.anim_offset) % cycle_duration
        progress = (t / (cycle_duration / 2)) if t < (cycle_duration / 2) else (2.0 - t / (cycle_duration / 2))
        line_y = int(progress * (H // 2 - 10)) + 5
        cv2.line(img, (0, line_y), (W, line_y), (0, 255, 0), 2)

        overlay = img.copy()
        cv2.rectangle(overlay, (0, max(0, line_y - 30)), (W, line_y), (0, 255, 0), -1)
        cv2.addWeighted(overlay, 0.2, img, 0.8, 0, img)

        if side.type == 'out':
            draw_btn(img, (W - 350, H//2 - 60, 160, 48), "MANUAL OPEN", (0,140,255))
            draw_btn(img, (W - 180, H//2 - 60, 160, 48), "PROLONG", (180,100,30))
        else:
            draw_btn(img, (W - 180, H//2 - 60, 160, 48), "MANUAL OPEN", (0,140,255))

        if side.type == 'in':
            max_cap = global_stats.get('maxCapacity', -1)
            curr_in = global_stats.get('currentlyIn', 0)
            if max_cap != -1 and curr_in >= max_cap:
                side.state = GateState.CAMPUS_FULL

    elif side.state == GateState.DETECTED:
        btn_text = "LET IN" if side.type == 'in' else "LET OUT"
        draw_btn(img, (25, H//2 - 65, 140, 48), btn_text)
        draw_btn(img, (185, H//2 - 65, 110, 48), "DENY", (0,0,200))

    elif side.state in (GateState.INVALID_QR, GateState.API_ERROR):
        draw_btn(img, (25, H//2 - 65, 180, 48), "OPEN MANUALLY", (0,140,255))
        draw_btn(img, (220, H//2 - 65, 110, 48), "DISMISS", (100,100,100))

    elif side.state == GateState.WARNING:
        draw_btn(img, (25, H//2 - 65, 250, 48), "ACKNOWLEDGE & PROCEED", (0,140,255))
        draw_btn(img, (290, H//2 - 65, 110, 48), "SKIP", (0,0,200))

    elif side.state == GateState.LOG_WARNING:
        box_x = 25
        draw_btn(img, (box_x + 25, H//2 - 65, 260, 48), "OVERRIDE & LET OUT" if side.type == 'out' else "OVERRIDE & LET IN", (0, 140, 255))
        draw_btn(img, (box_x + 305, H//2 - 65, 160, 48), "DENY (SKIP)", (0, 0, 200))

    elif side.state == GateState.TYPE_FULL:
        draw_btn(img, (25, H//2 - 65, 230, 48), "OVERRIDE (LET IN)", (0, 140, 255))
        draw_btn(img, (270, H//2 - 65, 110, 48), "DENY", (0, 0, 200))

    elif side.state in (GateState.BLOCKED, GateState.STATUS_DENIED):
        draw_btn(img, (25 + 25, H//2 - 65, 200, 48), "DENY ENTRY", (0, 0, 200))

    elif side.state == GateState.TIMEOUT:
        rem = max(0, int(side.timeout_end - time.time()))
        draw_btn(img, (25, H//2 - 65, 150, 48), "FORCE CLOSE", (0,0,200))
        if side.type == 'out':
            draw_btn(img, (190, H//2 - 65, 150, 48), "PROLONG", (180,100,30))
        if rem == 0: force_close_gate(side)

    elif side.state == GateState.PROLONG:
        draw_btn(img, (25, H//2 - 60, 150, 45), "CLOSE", (0, 0, 200))

    elif side.state == GateState.CAMPUS_FULL:
        draw_btn(img, (25, H//2 - 65, 230, 48), "OVERRIDE (LET IN)", (0,140,255))
        draw_btn(img, (270, H//2 - 65, 150, 48), "VIP ACCESS", (200,50,200))
        max_cap = global_stats.get('maxCapacity', -1)
        if max_cap == -1 or global_stats.get('currentlyIn', 0) < max_cap:
            side.state = GateState.SCANNING

    elif side.state == GateState.MANUAL_TYPE:
        draw_btn(img, (25, 110, 210, 50), "REGISTERED ACCESS", (150,100,50))
        draw_btn(img, (250, 110, 100, 50), "GUEST", (100,150,50))
        draw_btn(img, (365, 110, 150, 50), "VIP ACCESS", (200,50,200))
        draw_btn(img, (25, H//2 - 65, 100, 48), "CANCEL", (100,100,100))

    elif side.state == GateState.MANUAL_REG:
        draw_btn(img, (25, H//2 - 65, 120, 48), "LOOKUP", (50,200,50))
        draw_btn(img, (160, H//2 - 65, 100, 48), "CANCEL", (100,100,100))

    elif side.state in (GateState.MANUAL_GUEST_IN, GateState.MANUAL_GUEST_CONFIRM,
                        GateState.MANUAL_GUEST_OUT, GateState.MANUAL_GUEST_SEARCH_RESULT):
        draw_btn(img, (25, 130, 120, 42), "CANCEL", (100,100,100))

    elif side.state == GateState.GUEST_WARNING:
        draw_btn(img, (25, H//2 - 65, 250, 48), "ACKNOWLEDGE & PROCEED", (0,140,255))
        draw_btn(img, (290, H//2 - 65, 100, 48), "SKIP", (0,0,200))

def mouse_callback(event, x, y, flags, param):
    global log_scroll_offset
    global BACK_TO_CAMPUS
    global CURRENT_VIEW
    global latest_scanned_details
    
    if event == cv2.EVENT_MOUSEWHEEL:
        return
        
    if event != cv2.EVENT_LBUTTONDOWN:
        return
        
    # --- BOTTOM HALF CLICKS (y > H//2) ---
    if y > H//2:
        # Left side buttons (REFRESH & BACK)
        if x < 500:
            if in_rect(x, y, (30, H - 65, 120, 42)):
                print("Refresh clicked - updating parking availability data")
                refresh_parking_data()
                return
            if in_rect(x, y, (165, H - 65, 120, 42)):
                if side_in.state == GateState.SCANNING and side_out.state in (GateState.SCANNING, GateState.PROLONG):
                    print("DEBUG: BACK clicked - returning to campus selection")
                    BACK_TO_CAMPUS = True
                return
            return

        # Right side Guest Entry Form Clicks
        box_x = 520
        box_y = H//2 + 15
        if side_in.state == GateState.MANUAL_GUEST_IN:
            if in_rect(x, y, (box_x + 180, box_y + 85, 350, 38)):
                side_in.input_field = 0
                return
            elif in_rect(x, y, (box_x + 180, box_y + 133, 350, 38)):
                side_in.input_field = 1
                return
            elif in_rect(x, y, (box_x + 180, box_y + 181, 350, 38)):
                side_in.input_field = 2
                return
            elif in_rect(x, y, (box_x + 180, box_y + 245, 150, 45)): # CONFIRM
                side_in.state = GateState.MANUAL_GUEST_CONFIRM
                return
            elif in_rect(x, y, (box_x + 350, box_y + 245, 130, 45)): # CANCEL
                close_gate(side_in)
                return
        elif side_in.state == GateState.MANUAL_GUEST_CONFIRM:
            if in_rect(x, y, (box_x + 35, box_y + 240, 180, 48)): # GRANT ACCESS
                if side_in.form_data[0] == "VIP":
                    submit_vip(side_in)
                else:
                    submit_manual_guest(side_in)
                return
            elif in_rect(x, y, (box_x + 235, box_y + 240, 140, 48)): # BACK / EDIT
                side_in.state = GateState.MANUAL_GUEST_IN
                return

        # Right side Guest Exit Form Clicks
        if side_out.state == GateState.MANUAL_GUEST_OUT:
            if in_rect(x, y, (box_x + 180, box_y + 98, 350, 44)):
                side_out.input_field = 0
                return
            elif in_rect(x, y, (box_x + 180, box_y + 175, 150, 48)): # SEARCH
                search_guest(side_out)
                return
            elif in_rect(x, y, (box_x + 350, box_y + 175, 130, 48)): # CANCEL
                close_gate(side_out)
                return
        elif side_out.state == GateState.MANUAL_GUEST_SEARCH_RESULT:
            if in_rect(x, y, (box_x + 35, box_y + 245, 175, 48)): # ALLOW EXIT
                submit_guest_exit(side_out)
                return
            elif in_rect(x, y, (box_x + 235, box_y + 245, 130, 48)): # CANCEL
                close_gate(side_out)
                return

        return

    # --- TOP HALF CLICKS (y <= H//2) ---
    # Tab View Switch Button (top right)
    if CURRENT_VIEW == 'in':
        if in_rect(x, y, (W - 210, 15, 190, 42)): # Exit Camera >
            CURRENT_VIEW = 'out'
            print("Switched view to EXIT CAMERA")
            return
    else:
        if in_rect(x, y, (W - 245, 15, 225, 42)): # < Entrance Camera
            CURRENT_VIEW = 'in'
            print("Switched view to ENTRANCE CAMERA")
            return

    # Route top click to the currently visible gate side
    side = side_in if CURRENT_VIEW == 'in' else side_out
    
    if side.state == GateState.SCANNING:
        if side.type == 'out':
            if in_rect(x, y, (W - 180, H//2 - 60, 160, 48)): # PROLONG
                start_prolong_gate(side)
            elif in_rect(x, y, (W - 350, H//2 - 60, 160, 48)): # MANUAL OPEN
                side.state = GateState.MANUAL_TYPE
                side.form_data = ["", "", ""]
                side.snapshot = getattr(side, 'latest_crop', None)
        else:
            if in_rect(x, y, (W - 180, H//2 - 60, 160, 48)): # MANUAL OPEN
                side.state = GateState.MANUAL_TYPE
                side.form_data = ["", "", ""]
                side.snapshot = getattr(side, 'latest_crop', None)
    
    elif side.state == GateState.DETECTED:
        if in_rect(x, y, (25, H//2 - 65, 140, 48)):
            print(f"DEBUG: LET IN/OUT clicked for {side.type}")
            submit_entry_exit(side)
        elif in_rect(x, y, (185, H//2 - 65, 110, 48)):
            close_gate(side)
            
    elif side.state in (GateState.INVALID_QR, GateState.API_ERROR):
        if in_rect(x, y, (25, H//2 - 65, 180, 48)): # MANUAL OPEN
            print(f"DEBUG: Manual open clicked for {side.type}")
            manual_open_gate(side)
        elif in_rect(x, y, (220, H//2 - 65, 110, 48)): # DISMISS
            close_gate(side)
            
    elif side.state == GateState.WARNING:
        if in_rect(x, y, (25, H//2 - 65, 250, 48)):
            submit_entry_exit(side)
        elif in_rect(x, y, (290, H//2 - 65, 110, 48)):
            close_gate(side)

    elif side.state == GateState.TYPE_FULL:
        if in_rect(x, y, (25, H//2 - 65, 230, 48)):  # OVERRIDE (LET IN) the registered vehicle
            submit_entry_exit(side)
        elif in_rect(x, y, (270, H//2 - 65, 110, 48)):  # DENY
            close_gate(side)

    elif side.state in (GateState.BLOCKED, GateState.STATUS_DENIED):
        if in_rect(x, y, (25 + 25, H//2 - 65, 200, 48)):  # DENY ENTRY
            side.block_info = None
            close_gate(side)

    elif side.state == GateState.LOG_WARNING:
        # Buttons on enhanced duplicate entry banner
        box_x = 25
        if in_rect(x, y, (box_x + 25, H//2 - 65, 260, 48)):  # OVERRIDE & LET IN
            submit_entry_exit(side)
        elif in_rect(x, y, (box_x + 305, H//2 - 65, 160, 48)):  # DENY (SKIP)
            close_gate(side)
            
    elif side.state == GateState.TIMEOUT:
        if in_rect(x, y, (25, H//2 - 65, 150, 48)):
            force_close_gate(side)
        elif side.type == 'out' and in_rect(x, y, (190, H//2 - 65, 150, 48)): # PROLONG from timeout
            start_prolong_gate(side)

    elif side.state == GateState.PROLONG:
        # CLOSE button
        if in_rect(x, y, (25, H//2 - 60, 160, 48)) or in_rect(x, y, (55, H//2 - 60, 160, 48)):
            close_prolong_gate(side)
            
    elif side.state == GateState.CAMPUS_FULL:
        if in_rect(x, y, (25, H//2 - 65, 230, 48)):
            side.form_data = ["Override", "N/A", "Campus Full Override"]
            submit_manual_guest(side)
        elif in_rect(x, y, (270, H//2 - 65, 150, 48)):
            side.form_data = ["VIP", "VIP", "VIP Access"]
            submit_vip(side)
            
    elif side.state == GateState.MANUAL_TYPE:
        if in_rect(x, y, (25, 110, 210, 50)): # REGISTERED ACCESS
            side.state = GateState.MANUAL_REG
            side.form_data = ["", "", ""]
        elif in_rect(x, y, (250, 110, 100, 50)): # GUEST
            side.state = GateState.MANUAL_GUEST_IN if side.type == 'in' else GateState.MANUAL_GUEST_OUT
        elif in_rect(x, y, (365, 110, 150, 50)): # VIP ACCESS
            side.form_data = ["VIP", "VIP", "VIP Access"]
            submit_vip(side)
        elif in_rect(x, y, (25, H//2 - 65, 100, 48)):
            close_gate(side)
            
    elif side.state == GateState.MANUAL_REG:
        if in_rect(x, y, (25, H//2 - 65, 120, 48)): # LOOKUP
            plate_input = side.form_data[0].strip()
            if plate_input:
                side.state = GateState.PROCESSING
                threading.Thread(target=lookup_registered_plate, args=(side, plate_input), daemon=True).start()
        elif in_rect(x, y, (160, H//2 - 65, 100, 48)):
            close_gate(side)
            
    elif side.state in (GateState.MANUAL_GUEST_IN, GateState.MANUAL_GUEST_CONFIRM, GateState.MANUAL_GUEST_OUT, GateState.MANUAL_GUEST_SEARCH_RESULT):
        if in_rect(x, y, (25, 130, 120, 42)): # Top Cancel button
            close_gate(side)
            
    elif side.state == GateState.GUEST_WARNING:
        if in_rect(x, y, (25, H//2 - 65, 250, 48)):
            if side.form_data[0] == "VIP":
                submit_vip(side)
            else:
                submit_manual_guest(side)
        elif in_rect(x, y, (290, H//2 - 65, 100, 48)):
            close_gate(side)


print("DEBUG: Startup - Creating UI window...")
cv2.namedWindow("GateQR Dashboard", cv2.WINDOW_NORMAL)
cv2.setWindowProperty("GateQR Dashboard", cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

# ==============================================================================
# CAMPUS SELECTION (runs once at boot, before scanning starts)
# ==============================================================================
SELECTED_CAMPUS = None
CAMPUS_OPTIONS = ["Main", "Rnp", "Paseo"]
campus_btns = [(W//2 - 150, 220 + i*110, 300, 80) for i in range(len(CAMPUS_OPTIONS))]

def campus_mouse_callback(event, x, y, flags, param):
    global SELECTED_CAMPUS
    if event != cv2.EVENT_LBUTTONDOWN: return
    for name, rect in zip(CAMPUS_OPTIONS, campus_btns):
        if in_rect(x, y, rect):
            SELECTED_CAMPUS = name
            print(f"DEBUG: Campus selected: {SELECTED_CAMPUS}")

cv2.setMouseCallback("GateQR Dashboard", campus_mouse_callback)
print("DEBUG: Startup - Waiting for campus selection...")
while SELECTED_CAMPUS is None:
    screen = np.full((H, W, 3), (30, 30, 30), dtype=np.uint8)
    draw_text(screen, "SELECT CAMPUS", (W//2 - 150, 120), 1.2, (0, 255, 255), 3)
    draw_text(screen, "Tap a campus to start scanning", (W//2 - 190, 170), 0.8, (200, 200, 200), 2)
    for name, rect in zip(CAMPUS_OPTIONS, campus_btns):
        draw_btn(screen, rect, "", (50, 150, 200))
        draw_text(screen, name.upper(), (rect[0] + 90, rect[1] + 52), 1.1, (255, 255, 255), 2)
    cv2.imshow("GateQR Dashboard", screen)
    if cv2.waitKey(30) & 0xFF == 27:  # ESC to quit
        if cap1 is not None: cap1.release()
        if has_dual_cam and cap2 is not None: cap2.release()
        cv2.destroyAllWindows()
        raise SystemExit

# Campus chosen -> hand the mouse over to the normal gate UI
cv2.setMouseCallback("GateQR Dashboard", mouse_callback)

# ==============================================================================
# BACK BUTTON -> CHOOSE CAMPUS AGAIN
# ==============================================================================
BACK_TO_CAMPUS = False

def reselect_campus():
    """Show the campus selection screen again, then return to the gate UI."""
    global SELECTED_CAMPUS, CURRENT_VIEW
    SELECTED_CAMPUS = None
    CURRENT_VIEW = 'in'
    # Clear stats from the previous campus; the poller reloads them for the new one
    global_stats.clear()
    global_stats.update({"currentlyIn": 0, "visitsToday": 0, "maxCapacity": 200, "availableSlots": 200, "eventName": ""})
    cv2.setMouseCallback("GateQR Dashboard", campus_mouse_callback)
    print("DEBUG: Waiting for campus selection (BACK)...")
    while SELECTED_CAMPUS is None:
        screen = np.full((H, W, 3), (30, 30, 30), dtype=np.uint8)
        draw_text(screen, "SELECT CAMPUS", (W//2 - 150, 120), 1.2, (0, 255, 255), 3)
        draw_text(screen, "Tap a campus to start scanning", (W//2 - 190, 170), 0.8, (200, 200, 200), 2)
        for name, rect in zip(CAMPUS_OPTIONS, campus_btns):
            draw_btn(screen, rect, "", (50, 150, 200))
            draw_text(screen, name.upper(), (rect[0] + 90, rect[1] + 52), 1.1, (255, 255, 255), 2)
        cv2.imshow("GateQR Dashboard", screen)
        if cv2.waitKey(30) & 0xFF == 27:  # ESC to quit
            if cap1 is not None: cap1.release()
            if has_dual_cam and cap2 is not None: cap2.release()
            cv2.destroyAllWindows()
            raise SystemExit
    cv2.setMouseCallback("GateQR Dashboard", mouse_callback)

# Launch live camera HTTP streaming server in background
threading.Thread(target=start_camera_stream_server, daemon=True).start()

print("DEBUG: Startup - Entering main loop...")
while True:
    if BACK_TO_CAMPUS:
        BACK_TO_CAMPUS = False
        reselect_campus()
        continue

    if has_dual_cam:
        ret1, frame1 = cap1.read()
        ret2, frame2 = cap2.read()
        if not ret1 or not ret2: break
        
        frame1 = apply_zoom(frame1, CAMERA_ZOOM)
        frame2 = apply_zoom(frame2, CAMERA_ZOOM)
        
        crops = [(side_in, frame1), (side_out, frame2)]
        active_frame = frame1 if CURRENT_VIEW == 'in' else frame2
        disp_frame = cv2.resize(active_frame, (W, H//2))
        
        display = np.zeros((H, W, 3), dtype=np.uint8)
        display[0:H//2, 0:W] = disp_frame
    else:
        if has_cam1:
            ret, frame = cap1.read()
            if not ret: break
            frame = apply_zoom(frame, CAMERA_ZOOM)
        else:
            frame = np.zeros((H//2, W, 3), dtype=np.uint8)
            cv2.putText(frame, "NO CAMERA DETECTED (MOCK PREVIEW)", (W//2 - 250, H//4), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            time.sleep(0.05)
            
        disp_frame = cv2.resize(frame, (W, H//2))
        display = np.zeros((H, W, 3), dtype=np.uint8)
        display[0:H//2, 0:W] = disp_frame

        crops = [(side_in, frame), (side_out, frame)]

    # Update latest JPEG frames for live HTTP stream
    try:
        f_in = frame1 if has_dual_cam else frame
        f_out = frame2 if has_dual_cam else frame
        f_act = disp_frame

        stamp_time = datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
        c_label = str(SELECTED_CAMPUS or 'CAMPUS').upper()

        in_draw = f_in.copy()
        cv2.putText(in_draw, f"ENTRANCE - {c_label} | {stamp_time}", (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
        _, buf_in = cv2.imencode('.jpg', in_draw, [cv2.IMWRITE_JPEG_QUALITY, 70])

        out_draw = f_out.copy()
        cv2.putText(out_draw, f"EXIT - {c_label} | {stamp_time}", (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
        _, buf_out = cv2.imencode('.jpg', out_draw, [cv2.IMWRITE_JPEG_QUALITY, 70])

        act_draw = f_act.copy()
        _, buf_act = cv2.imencode('.jpg', act_draw, [cv2.IMWRITE_JPEG_QUALITY, 70])

        with latest_stream_lock:
            latest_stream_in_jpeg = buf_in.tobytes()
            latest_stream_out_jpeg = buf_out.tobytes()
            latest_stream_active_jpeg = buf_act.tobytes()
    except Exception as e:
        pass

    # Process QR for both sides if scanning
    for side, crop in crops:
        side.latest_crop = crop.copy()
        if side.state == GateState.SCANNING:
            if side.type == 'out' and time.time() < getattr(side, 'scan_cooldown_end', 0):
                pass  # 5-second cooldown active on exit camera
            else:
                decoded_objects = decode(crop, symbols=[ZBarSymbol.QRCODE])
                if decoded_objects:
                    data = decoded_objects[0].data.decode("utf-8")
                    print(f"[{side.type}] QR: {data}")
                    if side.type == 'out':
                        side.scan_cooldown_end = time.time() + 5.0
                        side.prolong_ready_time = time.time() + 5.0
                    side.state = GateState.PROCESSING  # Block re-trigger immediately
                    crop_copy = crop.copy()
                    threading.Thread(target=process_qr, args=(side, data, crop_copy), daemon=True).start()
        elif side.state == GateState.TIMEOUT and side.type == 'out':
            # For exit gate, allow QR scanning during timeout to refresh countdown (with 5 seconds delay)
            now = time.time()
            if now >= getattr(side, 'scan_cooldown_end', 0):
                decoded_objects = decode(crop, symbols=[ZBarSymbol.QRCODE])
                if decoded_objects:
                    data = decoded_objects[0].data.decode("utf-8")
                    side.scan_cooldown_end = now + 5.0
                    side.prolong_ready_time = now + 5.0
                    print(f"[{side.type}] QR detected during countdown - refreshing: {data} (5s cooldown)")
                    # Refresh countdown to 15 seconds
                    old_timeout = side.timeout_end
                    side.timeout_end = time.time() + 15
                    print(f"[{side.type}] Countdown refreshed from {max(0, int(old_timeout - time.time()))}s to 15s")
                    side.snapshot = crop.copy()
                    def _log_exit(qr_text=data):
                        try:
                            response = supabase.table('registration').select('*').eq('qr_code', qr_text).execute()
                            if not response.data:
                                response = supabase.table('registration').select('*').eq('qr_unique_code', qr_text).execute()
                            if response.data:
                                reg = response.data[0]
                                current_time = datetime.now().isoformat()
                                reg_id = reg['registration_id']
                                
                                # Fetch vehicle info
                                vehicle_data = {}
                                v_info_id = reg.get('vehicle_information_id')
                                if v_info_id:
                                    try:
                                        vres = supabase.table('vehicle_information').select('*').eq('vehicle_information_id', v_info_id).execute()
                                        if vres.data: vehicle_data = vres.data[0]
                                    except: pass
                                
                                # Close open vehicle_log row (revoked / unregistered / blocked exits are flagged)
                                exit_flag = exit_flag_for(reg, v_info_id)
                                flag_fields = {"flagged_alert": exit_flag[0], "reason": exit_flag[1]} if exit_flag else {}
                                try:
                                    all_logs = supabase.table('vehicle_log').select('vehicle_log_id, check_out').eq('registration_id', reg_id).execute()
                                    open_rows = [r for r in (all_logs.data or []) if not r.get('check_out')]
                                    if open_rows:
                                        for row in open_rows:
                                            supabase.table('vehicle_log').update({
                                                "check_out": current_time,
                                                "logged_status": "exited_campus",
                                                **flag_fields
                                            }).eq('vehicle_log_id', row['vehicle_log_id']).execute()
                                        print(f"[{side.type}] Closed {len(open_rows)} open log(s) during countdown")
                                    else:
                                        gate_enum, norm_campus_name = get_campus_gate_and_name()
                                        supabase.table('vehicle_log').insert({
                                            "vehicle_information_id": v_info_id or 1,
                                            "registration_id": reg_id,
                                            "check_in": current_time,
                                            "check_out": current_time,
                                            "logged_status": "exited_campus",
                                            "sticker_status": "registered",
                                            "campus_gate": gate_enum,
                                            "campus": norm_campus_name,
                                            **flag_fields
                                        }).execute()
                                except Exception as e:
                                    print(f"DEBUG: Error updating exit log during countdown: {e}")

                                # Update latest_scanned_details
                                first_n = reg.get('first_name', '')
                                last_n = reg.get('last_name', '')
                                d_name = f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A'
                                d_role = (reg.get('role') or 'N/A').capitalize()
                                d_plate = vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A'
                                d_brand = vehicle_data.get('brand') or reg.get('brand') or 'N/A'
                                d_type = vehicle_data.get('type') or reg.get('type') or 'N/A'
                                d_col = vehicle_data.get('color') or ''
                                if d_col: d_brand = f"{d_brand} ({d_col})"

                                global latest_scanned_details, global_logs
                                latest_scanned_details = {
                                    "gate": "EXIT",
                                    "name": d_name,
                                    "role": d_role,
                                    "plate": d_plate,
                                    "brand": d_brand,
                                    "type": d_type,
                                    "status": "EXIT APPROVED",
                                    "time": datetime.now().strftime("%I:%M:%S %p")
                                }
                                global_logs.insert(0, {
                                    "time": datetime.now().strftime("%H:%M:%S"),
                                    "bound": "OUT",
                                    "name": d_name[:12],
                                    "plate": d_plate[:10]
                                })
                                sync_parking_availability()
                                refresh_parking_data()
                                print(f"[{side.type}] Exit logged and capacity synced for {data}")
                        except Exception as e:
                            print(f"Error logging exit during countdown: {e}")
                    threading.Thread(target=_log_exit, daemon=True).start()

        elif side.state == GateState.PROLONG and side.type == 'out':
            # PROLONG mode: Barrier permanently open, scan QR with 5 seconds delay between vehicles
            now = time.time()
            cd_end = max(getattr(side, 'scan_cooldown_end', 0), getattr(side, 'prolong_ready_time', 0))
            if now >= cd_end:
                decoded_objects = decode(crop, symbols=[ZBarSymbol.QRCODE])
                if decoded_objects:
                    data = decoded_objects[0].data.decode("utf-8")
                    # Set 5 seconds delay before next scan is accepted
                    side.scan_cooldown_end = now + 5.0
                    side.prolong_ready_time = now + 5.0
                    side.last_prolong_exit = {
                        "plate": "PROCESSING...",
                        "name": "VERIFYING EXIT...",
                        "role": "EXIT",
                        "time": datetime.now().strftime("%I:%M:%S %p"),
                        "status": "EXITED"
                    }
                    print(f"[{side.type}] PROLONG: QR detected: {data} -> 5-second cooldown active")
                    side.snapshot = crop.copy()
                    
                    def _log_prolong_exit(qr_text=data):
                        try:
                            response = supabase.table('registration').select('*').eq('qr_code', qr_text).execute()
                            if not response.data:
                                response = supabase.table('registration').select('*').eq('qr_unique_code', qr_text).execute()
                            if response.data:
                                reg = response.data[0]
                                current_time = datetime.now().isoformat()
                                reg_id = reg['registration_id']
                                
                                # Fetch vehicle info
                                vehicle_data = {}
                                v_info_id = reg.get('vehicle_information_id')
                                if v_info_id:
                                    try:
                                        vres = supabase.table('vehicle_information').select('*').eq('vehicle_information_id', v_info_id).execute()
                                        if vres.data: vehicle_data = vres.data[0]
                                    except: pass
                                
                                # Close open vehicle_log row (revoked / unregistered / blocked exits are flagged)
                                exit_flag = exit_flag_for(reg, v_info_id)
                                flag_fields = {"flagged_alert": exit_flag[0], "reason": exit_flag[1]} if exit_flag else {}
                                try:
                                    all_logs = supabase.table('vehicle_log').select('vehicle_log_id, check_out').eq('registration_id', reg_id).execute()
                                    open_rows = [r for r in (all_logs.data or []) if not r.get('check_out')]
                                    if open_rows:
                                        for row in open_rows:
                                            supabase.table('vehicle_log').update({
                                                "check_out": current_time,
                                                "logged_status": "exited_campus",
                                                **flag_fields
                                            }).eq('vehicle_log_id', row['vehicle_log_id']).execute()
                                        print(f"[{side.type}] PROLONG: Closed {len(open_rows)} open log(s)")
                                    else:
                                        gate_enum, norm_campus_name = get_campus_gate_and_name()
                                        supabase.table('vehicle_log').insert({
                                            "vehicle_information_id": v_info_id or 1,
                                            "registration_id": reg_id,
                                            "check_in": current_time,
                                            "check_out": current_time,
                                            "logged_status": "exited_campus",
                                            "sticker_status": "registered",
                                            "campus_gate": gate_enum,
                                            "campus": norm_campus_name,
                                            **flag_fields
                                        }).execute()
                                except Exception as e:
                                    print(f"DEBUG: Error updating exit log in prolong: {e}")

                                # Update latest_scanned_details and last_prolong_exit
                                first_n = reg.get('first_name', '')
                                last_n = reg.get('last_name', '')
                                d_name = f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A'
                                d_role = (reg.get('role') or 'N/A').capitalize()
                                d_plate = vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A'
                                d_brand = vehicle_data.get('brand') or reg.get('brand') or 'N/A'
                                d_type = vehicle_data.get('type') or reg.get('type') or 'N/A'
                                d_col = vehicle_data.get('color') or ''
                                if d_col: d_brand = f"{d_brand} ({d_col})"

                                side.last_prolong_exit = {
                                    "plate": d_plate,
                                    "name": d_name,
                                    "role": d_role,
                                    "brand": d_brand,
                                    "type": d_type,
                                    "time": datetime.now().strftime("%I:%M:%S %p"),
                                    "status": "EXITED"
                                }

                                global latest_scanned_details, global_logs
                                latest_scanned_details = {
                                    "gate": "EXIT",
                                    "name": d_name,
                                    "role": d_role,
                                    "plate": d_plate,
                                    "brand": d_brand,
                                    "type": d_type,
                                    "status": "EXITED",
                                    "time": datetime.now().strftime("%I:%M:%S %p")
                                }
                                global_logs.insert(0, {
                                    "time": datetime.now().strftime("%H:%M:%S"),
                                    "bound": "OUT",
                                    "name": d_name[:12],
                                    "plate": d_plate[:10]
                                })
                                sync_parking_availability()
                                refresh_parking_data()
                                print(f"[{side.type}] PROLONG exit logged for {d_plate} ({d_name})")
                        except Exception as e:
                            print(f"Error in prolong exit: {e}")
                    threading.Thread(target=_log_prolong_exit, daemon=True).start()

        elif side.state == GateState.PROCESSING:
            pass

    # Render active camera overlay (full width W x H//2)
    active_side = side_in if CURRENT_VIEW == 'in' else side_out
    render_side(display, active_side, 0)

    # Render full-width cream bottom panel with campus capacity & scanned QR info box
    render_bottom_panel(display)

    cv2.imshow("GateQR Dashboard", display)
    
    key = cv2.waitKey(10) & 0xFF
    if key == 27: # ESC
        break
    elif key != 255: # some key pressed
        char = chr(key) if key < 128 else ""
        
        # Route keystroke to active form field
        for side in [side_in, side_out]:
            if side.state in [GateState.MANUAL_REG, GateState.MANUAL_GUEST_OUT]:
                if key == 8: side.form_data[0] = side.form_data[0][:-1] # backspace
                elif re.match(r'[a-zA-Z0-9\-_ ]', char): side.form_data[0] += char.upper()
            elif side.state == GateState.MANUAL_GUEST_IN:
                idx = side.input_field
                if idx < len(side.form_data):
                    if key == 8: side.form_data[idx] = side.form_data[idx][:-1]
                    elif char.isprintable(): side.form_data[idx] += char.upper()

if cap1 is not None:
    cap1.release()
if has_dual_cam and cap2 is not None: cap2.release()
cv2.destroyAllWindows()