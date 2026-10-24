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
from datetime import datetime
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
    MANUAL_REG = "MANUAL_REG"         # Ask: Reg ID
    MANUAL_GUEST_IN = "MANUAL_GUEST_IN"   # Ask: Name, Plate, ID Number, Purpose
    MANUAL_GUEST_CONFIRM = "MANUAL_GUEST_CONFIRM"  # Confirm/Reject after filling form
    MANUAL_GUEST_OUT = "MANUAL_GUEST_OUT" # Ask: Search by Name or Plate
    MANUAL_GUEST_SEARCH_RESULT = "MANUAL_GUEST_SEARCH_RESULT"  # Display search result
    GUEST_WARNING = "GUEST_WARNING"
    LOG_WARNING = "LOG_WARNING"  # Same-day double-in or double-out warning
    PROCESSING = "PROCESSING"   # QR detected, waiting for API response
    CAMPUS_FULL = "CAMPUS_FULL"

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

global_stats = {"currentlyIn": 0, "visitsToday": 0, "maxCapacity": 200, "availableSlots": 200, "eventName": ""}
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
        res = supabase.table('vehicle_log').select('vehicle_log_id, check_in, check_out, logged_status, campus, campus_gate, registration_id, vip_access, guest_id').ilike('campus', f"%{norm_campus}%").execute()
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
            return active_occupied
        return 0
    except Exception as e:
        print(f"DEBUG: Error querying occupied count for {norm_campus}: {e}")
        return 0

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
        capacity = 200
        if pa_res.data and pa_res.data[0].get('parking_capacity'):
            capacity = pa_res.data[0]['parking_capacity']
        elif pa_res.data and pa_res.data[0].get('capacity'):
            capacity = pa_res.data[0]['capacity']
            
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
        capacity = 200
        if pa_res.data and pa_res.data[0].get('parking_capacity'):
            capacity = pa_res.data[0]['parking_capacity']
        elif pa_res.data and pa_res.data[0].get('capacity'):
            capacity = pa_res.data[0]['capacity']

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
                capacity = 200
                if pa_res.data and pa_res.data[0].get('parking_capacity'):
                    capacity = pa_res.data[0]['parking_capacity']
                elif pa_res.data and pa_res.data[0].get('capacity'):
                    capacity = pa_res.data[0]['capacity']

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
            
            reg = response.data[0]
            side.data = reg
            
            # Get vehicle information from separate table
            try:
                print(f"DEBUG: Registration data: {reg}")
                vehicle_info_id = reg.get('vehicle_information_id')
                print(f"DEBUG: vehicle_information_id from registration: {vehicle_info_id}")
                
                if vehicle_info_id:
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
                        side.anomaly_desc = f"DUPLICATE ENTRY VIOLATION: Currently checked in at {active_campus_norm.upper()} (at {check_in_time})! Cannot enter {current_campus_norm.upper()}."
                        reason_text = f"Duplicate Entry: Currently checked in at {active_campus_norm}, attempted entry at {current_campus_norm}"
                    else:
                        side.anomaly_desc = f"DUPLICATE ENTRY: Vehicle already INSIDE {current_campus_norm.upper()} (Entered at {check_in_time})!"
                        reason_text = f"Duplicate Entry: Vehicle already inside {current_campus_norm}"

                    # Log the flagged violation to database
                    try:
                        supabase.table('vehicle_log').insert({
                            "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id') or 1,
                            "registration_id": reg['registration_id'],
                            "check_in": datetime.now().isoformat(),
                            "check_out": datetime.now().isoformat(),
                            "logged_status": "Denied",
                            "sticker_status": "registered",
                            "campus_gate": current_gate,
                            "campus": current_campus_norm,
                            "reason": reason_text
                        }).execute()
                    except Exception as err:
                        print(f"DEBUG: Error logging duplicate entry violation: {err}")

                    latest_scanned_details = {
                        "gate": "ENTRANCE",
                        "name": driver_name,
                        "role": role_name,
                        "plate": v_plate,
                        "brand": full_brand,
                        "type": v_type,
                        "status": "FLAGGED (DUPLICATE ENTRY)",
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
                                "logged_status": "Denied",
                                "sticker_status": "registered",
                                "campus_gate": current_gate,
                                "campus": current_campus_norm,
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
            if side.type == 'out':
                print(f"DEBUG: Exit gate - auto-opening for valid QR")
                submit_entry_exit(side)
                return

            # --- Entrance gate: valid QR codes go to DETECTED state (REGISTERED) ---
            side.state = GateState.DETECTED
            
        except Exception as e:
            side.state = GateState.API_ERROR
            side.api_error = f"Supabase lookup error: {str(e)}"
            side.snapshot = frame.copy()
            
    except Exception as e:
        side.state = GateState.API_ERROR
        side.api_error = str(e)
        side.snapshot = frame.copy()

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
                try:
                    all_logs = supabase.table('vehicle_log').select('vehicle_log_id, check_out').eq('registration_id', reg_id).execute()
                    open_rows = [r for r in (all_logs.data or []) if not r.get('check_out')]
                    if open_rows:
                        for row in open_rows:
                            supabase.table('vehicle_log').update({
                                "check_out": current_time,
                                "logged_status": "exited_campus"
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
                            "campus": norm_campus_name
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
    
    view_label = "ACTIVE: ENTRANCE CAMERA" if CURRENT_VIEW == 'in' else "ACTIVE: EXIT CAMERA"
    draw_text(display, view_label, (30, H//2 + 220), 0.65, (90, 95, 105), 2)
    
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
    
    # If the barrier is closed, the scanned QR code details display will disappear
    barrier_open_or_active = (
        side_in.state in (GateState.TIMEOUT, GateState.PROLONG, GateState.DETECTED, GateState.PROCESSING, GateState.LOG_WARNING, GateState.WARNING) or
        side_out.state in (GateState.TIMEOUT, GateState.PROLONG, GateState.PROCESSING, GateState.LOG_WARNING, GateState.WARNING)
    )
    global latest_scanned_details
    if not barrier_open_or_active:
        latest_scanned_details = None

    if latest_scanned_details:
        gate_txt = latest_scanned_details.get('gate', 'GATE')
        t_txt = latest_scanned_details.get('time', '')
        st_txt = latest_scanned_details.get('status', 'OK')
        if "FLAGGED" in st_txt.upper() or "DENIED" in st_txt.upper() or "WARNING" in st_txt.upper():
            st_col = (0, 0, 220)
        elif ("REG" in st_txt.upper() or "APP" in st_txt.upper() or "INSIDE" in st_txt.upper()):
            st_col = (20, 140, 30)
        else:
            st_col = (180, 70, 20)
        
        draw_text(display, f"[{gate_txt}] Time: {t_txt}", (box_x + 20, box_y + 85), 0.68, (70, 75, 85), 1)
        draw_text(display, f"Status: {st_txt}", (box_x + 360, box_y + 85), 0.72, st_col, 2)
        
        role_txt = latest_scanned_details.get('role', 'N/A')
        draw_text(display, f"Role: {role_txt}", (box_x + 20, box_y + 125), 0.72, (20, 25, 35), 2)
        
        plate_txt = latest_scanned_details.get('plate', 'N/A')
        type_txt = latest_scanned_details.get('type', 'N/A')
        draw_text(display, f"Plate: {plate_txt}   |   Type: {type_txt}", (box_x + 20, box_y + 165), 0.72, (170, 60, 20), 2)
        
        brand_txt = latest_scanned_details.get('brand', 'N/A')
        draw_text(display, f"Vehicle: {brand_txt}", (box_x + 20, box_y + 205), 0.70, (40, 45, 55), 1)
        
        draw_text(display, "* Realtime registration record synced & verified with Supabase", (box_x + 20, box_y + 250), 0.58, (110, 115, 125), 1)
    else:
        draw_text(display, "NO QR CODE SCANNED YET", (box_x + 25, box_y + 105), 0.82, (120, 125, 135), 2)
        draw_text(display, "Point any vehicle QR sticker to the active camera scanner.", (box_x + 25, box_y + 145), 0.65, (75, 80, 90), 1)
        draw_text(display, "The vehicle's details and entry/exit status will display here.", (box_x + 25, box_y + 180), 0.62, (95, 100, 110), 1)
        draw_text(display, "Click 'Exit Camera >' or '< Entrance Camera' button above to switch views.", (box_x + 25, box_y + 225), 0.62, (45, 120, 190), 1)

def render_side(img, side, offset_x=0):
    # Full-width camera layout (W x H//2)
    cx = offset_x
    title = "ENTRANCE CAMERA" if side.type == 'in' else "EXIT CAMERA"
    draw_text(img, title, (25, 38), 1.0, (0, 255, 255), 2)

    # Top-right View Toggle Button
    if CURRENT_VIEW == 'in':
        draw_btn(img, (W - 210, 15, 190, 42), "Exit Camera >", (50, 150, 220))
    else:
        draw_btn(img, (W - 245, 15, 225, 42), "< Entrance Camera", (50, 150, 220))

    # State machine UI
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

        if side.type == 'out' and time.time() < getattr(side, 'scan_cooldown_end', 0):
            wait_s = max(1, int(side.scan_cooldown_end - time.time()) + 1)
            draw_text(img, f"Scanner Cooldown: Ready in {wait_s}s", (25, 80), 0.8, (0, 200, 255), 2)
            draw_text(img, "Please wait 5s before scanning next exit QR", (25, 110), 0.6)
        else:
            draw_text(img, "No QR Code Detected", (25, 80), 0.8, (0, 255, 255), 2)
            draw_text(img, "Hold QR code in camera view", (25, 110), 0.6)

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
        vehicle_data = getattr(side, 'vehicle_data', {})
        if not vehicle_data:
            try:
                vehicle_info_id = side.data.get('vehicle_information_id')
                if vehicle_info_id:
                    vehicle_response = supabase.table('vehicle_information').select('*').eq('vehicle_information_id', vehicle_info_id).execute()
                    if vehicle_response.data:
                        side.vehicle_data = vehicle_response.data[0]
                        vehicle_data = side.vehicle_data
            except:
                pass
        
        btn_text = "LET IN" if side.type == 'in' else "LET OUT"
        draw_btn(img, (25, H//2 - 65, 140, 48), btn_text)
        draw_btn(img, (185, H//2 - 65, 110, 48), "SKIP", (0,0,200))
        
    elif side.state == GateState.INVALID_QR:
        draw_text(img, "INVALID QR CODE", (25, 80), 0.8, (0,0,255), 2)
        draw_text(img, f"Content: {str(side.data)[:25]}...", (25, 110), 0.6)
        draw_text(img, "Not a recognized registration.", (25, 140), 0.6)
        draw_btn(img, (25, H//2 - 65, 180, 48), "OPEN MANUALLY", (0,140,255))
        draw_btn(img, (220, H//2 - 65, 110, 48), "DISMISS", (100,100,100))
        
    elif side.state == GateState.WARNING:
        draw_text(img, "ANOMALY WARNING", (25, 80), 0.8, (0,165,255), 2)
        draw_text(img, side.anomaly_desc, (25, 110), 0.6)
        draw_btn(img, (25, H//2 - 65, 250, 48), "ACKNOWLEDGE & PROCEED", (0,140,255))
        draw_btn(img, (290, H//2 - 65, 110, 48), "SKIP", (0,0,200))
        
    elif side.state == GateState.LOG_WARNING:
        # High-impact alert box for cross-campus duplicate entry flag
        box_x = 25
        box_y = 55
        box_w = W - 50
        box_h = H//2 - 75
        
        overlay = img.copy()
        cv2.rectangle(overlay, (box_x, box_y), (box_x + box_w, box_y + box_h), (10, 10, 60), -1)
        cv2.addWeighted(overlay, 0.90, img, 0.10, 0, img)
        cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h), (0, 0, 255), 3)
        
        cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + 45), (0, 0, 180), -1)
        if side.type == 'out':
            draw_text(img, "!! FLAGGED: WRONG CAMPUS EXIT WARNING !!", (box_x + 20, box_y + 32), 0.90, (255, 255, 255), 3)
            draw_text(img, side.anomaly_desc, (box_x + 25, box_y + 80), 0.72, (0, 220, 255), 2)
            draw_text(img, "Security Notice: Vehicle was checked in at another campus and cannot exit here.", (box_x + 25, box_y + 115), 0.62, (200, 220, 200), 1)
            draw_text(img, "Wrong campus exit violation flagged and logged. Security override required.", (box_x + 25, box_y + 145), 0.58, (180, 180, 180), 1)
            draw_btn(img, (box_x + 25, H//2 - 65, 260, 48), "OVERRIDE & LET OUT", (0, 140, 255))
        else:
            draw_text(img, "!! FLAGGED: DUPLICATE ENTRY WARNING !!", (box_x + 20, box_y + 32), 0.90, (255, 255, 255), 3)
            draw_text(img, side.anomaly_desc, (box_x + 25, box_y + 80), 0.72, (0, 220, 255), 2)
            draw_text(img, "Security Notice: Vehicle is currently marked inside a campus and has not checked out.", (box_x + 25, box_y + 115), 0.62, (200, 220, 200), 1)
            draw_text(img, "Duplicate entry violation flagged and logged. Security override required.", (box_x + 25, box_y + 145), 0.58, (180, 180, 180), 1)
            draw_btn(img, (box_x + 25, H//2 - 65, 260, 48), "OVERRIDE & LET IN", (0, 140, 255))
        
        draw_btn(img, (box_x + 305, H//2 - 65, 160, 48), "DENY (SKIP)", (0, 0, 200))

    elif side.state == GateState.API_ERROR:
        draw_text(img, "API ERROR", (25, 80), 0.8, (0,0,255), 2)
        draw_text(img, side.api_error[:50], (25, 110), 0.6)
        draw_btn(img, (25, H//2 - 65, 180, 48), "OPEN MANUALLY", (0,140,255))
        draw_btn(img, (220, H//2 - 65, 110, 48), "DISMISS", (100,100,100))

    elif side.state == GateState.TIMEOUT:
        rem = max(0, int(side.timeout_end - time.time()))
        draw_text(img, f"GATE OPEN - Closing in {rem}s", (25, 140), 1.0, (0,255,0), 2)
        if side.type == 'out':
            now = time.time()
            if now < getattr(side, 'scan_cooldown_end', 0):
                wait_s = max(1, int(side.scan_cooldown_end - now) + 1)
                draw_text(img, f"Exit Logged! Next scan ready in: {wait_s}s", (25, 175), 0.65, (0, 200, 255), 2)
            else:
                draw_text(img, "Scan QR to refresh timer (5s delay)", (25, 175), 0.6, (200, 200, 200))
            draw_btn(img, (25, H//2 - 65, 150, 48), "FORCE CLOSE", (0,0,200))
            draw_btn(img, (190, H//2 - 65, 150, 48), "PROLONG", (180,100,30))
        else:
            draw_btn(img, (25, H//2 - 65, 150, 48), "FORCE CLOSE", (0,0,200))
        if rem == 0: force_close_gate(side)

    elif side.state == GateState.PROLONG:
        now = time.time()
        cd_end = max(getattr(side, 'scan_cooldown_end', 0), getattr(side, 'prolong_ready_time', 0))
        if now < cd_end:
            wait_s = max(1, int(cd_end - now) + 1)
            
            # Full-width EXITED feature card
            card_x = 25
            card_y = 15
            card_w = W - 50
            card_h = H//2 - 80
            
            overlay = img.copy()
            cv2.rectangle(overlay, (card_x, card_y), (card_x + card_w, card_y + card_h), (10, 42, 16), -1)
            cv2.addWeighted(overlay, 0.90, img, 0.10, 0, img)
            cv2.rectangle(img, (card_x, card_y), (card_x + card_w, card_y + card_h), (0, 255, 0), 3)
            
            cv2.rectangle(img, (card_x, card_y), (card_x + card_w, card_y + 55), (0, 160, 45), -1)
            draw_text(img, "EXITED", (card_x + card_w//2 - 75, card_y + 40), 1.3, (255, 255, 255), 4)
            
            draw_text(img, "VEHICLE DEPARTURE CONFIRMED & LOGGED", (card_x + 30, card_y + 85), 0.68, (0, 255, 200), 2)
            
            p_info = getattr(side, 'last_prolong_exit', {})
            plate_txt = p_info.get('plate') or (latest_scanned_details.get('plate') if latest_scanned_details else 'N/A')
            driver_txt = p_info.get('name') or (latest_scanned_details.get('name') if latest_scanned_details else 'Driver')
            role_txt = p_info.get('role') or (latest_scanned_details.get('role') if latest_scanned_details else '')
            time_txt = p_info.get('time') or datetime.now().strftime("%I:%M:%S %p")
            
            draw_text(img, f"Plate Number : {plate_txt}", (card_x + 30, card_y + 125), 0.85, (255, 255, 255), 2)
            draw_text(img, f"Role         : {role_txt}", (card_x + 30, card_y + 160), 0.72, (0, 255, 255), 2)
            draw_text(img, f"Time Logged  : {time_txt}", (card_x + 30, card_y + 192), 0.68, (200, 220, 200), 1)
            
            draw_text(img, f"Scanner ready in {wait_s}s to scan next vehicle...", (card_x + 30, card_y + 225), 0.68, (0, 230, 255), 2)
            draw_btn(img, (card_x + 30, H//2 - 60, 150, 45), "CLOSE", (0, 0, 200))
        else:
            draw_text(img, "BARRIER PERMANENT OPEN (PROLONG)", (25, 50), 0.85, (0, 255, 0), 2)
            draw_text(img, "SCANNING FOR EXIT QR CODES", (25, 90), 0.85, (0, 255, 255), 2)
            draw_text(img, "Hold QR code in camera view to exit (5s delay between cars)", (25, 120), 0.6, (200, 200, 200), 1)
            draw_btn(img, (25, H//2 - 60, 150, 45), "CLOSE", (0, 0, 200))
        
    elif side.state == GateState.CAMPUS_FULL:
        draw_text(img, "CAMPUS FULL", (25, 80), 1.0, (0,0,255), 3)
        max_cap = global_stats.get('maxCapacity', -1)
        cap_str = str(max_cap) if max_cap != -1 else "No Limit"
        currently_in = global_stats.get('currentlyIn', 0)
        available_slots = global_stats.get('availableSlots', 0)
        
        draw_text(img, f"Total Capacity: {cap_str}", (25, 120), 0.7)
        draw_text(img, f"Currently In: {currently_in}", (25, 150), 0.7)
        draw_text(img, f"Available Slots: {available_slots}", (25, 180), 0.7, (0, 200, 255))
        draw_btn(img, (25, H//2 - 65, 230, 48), "OVERRIDE (LET IN)", (0,140,255))
        draw_btn(img, (270, H//2 - 65, 150, 48), "VIP ACCESS", (200,50,200))
        
        if max_cap == -1 or currently_in < max_cap:
            side.state = GateState.SCANNING

    elif side.state == GateState.MANUAL_TYPE:
        draw_text(img, "MANUAL ENTRY", (25, 80), 0.8, (255,255,255), 2)
        draw_btn(img, (25, 110, 120, 50), "REG ID", (150,100,50))
        draw_btn(img, (160, 110, 100, 50), "GUEST", (100,150,50))
        draw_btn(img, (280, 110, 150, 50), "VIP ACCESS", (200,50,200))
        draw_btn(img, (25, H//2 - 65, 100, 48), "CANCEL", (100,100,100))
        
    elif side.state == GateState.MANUAL_REG:
        draw_text(img, "ENTER REG ID (Type on keyboard)", (25, 80), 0.7)
        cv2.rectangle(img, (25, 100), (320, 140), (255,255,255), 1)
        draw_text(img, side.form_data[0] + "_", (35, 125), 0.7)
        draw_btn(img, (25, H//2 - 65, 120, 48), "LOOKUP", (50,200,50))
        draw_btn(img, (160, H//2 - 65, 100, 48), "CANCEL", (100,100,100))
        
    elif side.state in (GateState.MANUAL_GUEST_IN, GateState.MANUAL_GUEST_CONFIRM):
        draw_text(img, "GUEST FORM ACTIVE", (25, 65), 0.85, (0, 255, 255), 2)
        draw_text(img, "Fill out guest details in panel below.", (25, 100), 0.62, (200, 200, 200), 1)
        draw_btn(img, (25, 130, 120, 42), "CANCEL", (100,100,100))
    
    elif side.state in (GateState.MANUAL_GUEST_OUT, GateState.MANUAL_GUEST_SEARCH_RESULT):
        draw_text(img, "GUEST EXIT ACTIVE", (25, 65), 0.85, (0, 255, 255), 2)
        draw_text(img, "Search guest by plate in panel below.", (25, 100), 0.62, (200, 200, 200), 1)
        draw_btn(img, (25, 130, 120, 42), "CANCEL", (100,100,100))
    
    elif side.state == GateState.GUEST_WARNING:
        draw_text(img, "GUEST ANOMALY", (25, 80), 0.8, (0,165,255), 2)
        draw_text(img, side.anomaly_desc[:55], (25, 110), 0.55, (0,200,255))
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
        if in_rect(x, y, (25, 110, 120, 50)): # REG ID
            side.state = GateState.MANUAL_REG
        elif in_rect(x, y, (160, 110, 100, 50)): # GUEST
            side.state = GateState.MANUAL_GUEST_IN if side.type == 'in' else GateState.MANUAL_GUEST_OUT
        elif in_rect(x, y, (280, 110, 150, 50)): # VIP ACCESS
            side.form_data = ["VIP", "VIP", "VIP Access"]
            submit_vip(side)
        elif in_rect(x, y, (25, H//2 - 65, 100, 48)):
            close_gate(side)
            
    elif side.state == GateState.MANUAL_REG:
        if in_rect(x, y, (25, H//2 - 65, 120, 48)): # LOOKUP
            reg_id = side.form_data[0].strip()
            if reg_id:
                try:
                    response = supabase.table('registration').select('*').eq('registration_id', reg_id).execute()
                    if response.data:
                        reg = response.data[0]
                        side.data = reg
                        side.snapshot = side.snapshot if side.snapshot is not None else np.zeros((H//2, W, 3), dtype=np.uint8)
                        side.logged_status = "REGISTERED"
                        
                        try:
                            vehicle_info_id = reg.get('vehicle_information_id')
                            if vehicle_info_id:
                                vehicle_response = supabase.table('vehicle_information').select('*').eq('vehicle_information_id', vehicle_info_id).execute()
                                side.vehicle_data = vehicle_response.data[0] if vehicle_response.data else {}
                            else:
                                side.vehicle_data = {}
                        except:
                            side.vehicle_data = {}
                        
                        # Cross-campus open log check for duplicate entry
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
                                    if (has_in and not has_out) or st in ('inside', 'inside_campus'):
                                        if st not in ('exited', 'exit', 'denied', 'exited_campus'):
                                            open_cross_log = l_row
                                            break
                        except:
                            open_cross_log = None

                        side.logged_status = "REGISTERED"
                        side.status_warning_pending = False

                        current_gate, current_campus = get_campus_gate_and_name()
                        current_campus_norm = normalize_campus_name(current_campus)

                        first_n = reg.get('first_name', '')
                        last_n = reg.get('last_name', '')
                        driver_name = f"{first_n} {last_n}".strip() or reg.get('name') or 'N/A'
                        role_name = (reg.get('role') or 'N/A').capitalize()
                        v_plate = side.vehicle_data.get('plate_number') or reg.get('plate_number') or 'N/A'
                        v_brand = side.vehicle_data.get('brand') or reg.get('brand') or 'N/A'
                        v_type = side.vehicle_data.get('type') or reg.get('type') or 'N/A'
                        v_color = side.vehicle_data.get('color') or ''
                        full_brand = f"{v_brand} ({v_color})" if v_color else v_brand

                        if open_cross_log:
                            active_campus_norm = normalize_campus_name(open_cross_log.get('campus'))
                            check_in_time = open_cross_log.get('check_in', '')
                            try:
                                dt = datetime.fromisoformat(check_in_time.replace('Z', '+00:00'))
                                check_in_time = dt.strftime('%I:%M %p')
                            except:
                                pass

                            if side.type == 'in':
                                if active_campus_norm != current_campus_norm:
                                    side.anomaly_desc = f"DUPLICATE ENTRY VIOLATION: Currently checked in at {active_campus_norm.upper()} (at {check_in_time})! Cannot enter {current_campus_norm.upper()}."
                                    reason_text = f"Duplicate Entry: Currently checked in at {active_campus_norm}, attempted entry at {current_campus_norm}"
                                else:
                                    side.anomaly_desc = f"DUPLICATE ENTRY: Vehicle already INSIDE {current_campus_norm.upper()} (Entered at {check_in_time})!"
                                    reason_text = f"Duplicate Entry: Vehicle already inside {current_campus_norm}"

                                try:
                                    supabase.table('vehicle_log').insert({
                                        "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id') or 1,
                                        "registration_id": reg['registration_id'],
                                        "check_in": datetime.now().isoformat(),
                                        "check_out": datetime.now().isoformat(),
                                        "logged_status": "Denied",
                                        "sticker_status": "registered",
                                        "campus_gate": current_gate,
                                        "campus": current_campus_norm,
                                        "reason": reason_text
                                    }).execute()
                                except: pass

                                latest_scanned_details = {
                                    "gate": "ENTRANCE",
                                    "name": driver_name,
                                    "role": role_name,
                                    "plate": v_plate,
                                    "brand": full_brand,
                                    "type": v_type,
                                    "status": "FLAGGED (DUPLICATE ENTRY)",
                                    "time": datetime.now().strftime("%I:%M:%S %p")
                                }
                                side.anomaly_id = open_cross_log.get('vehicle_log_id')
                                side.state = GateState.LOG_WARNING
                            elif side.type == 'out' and active_campus_norm != current_campus_norm:
                                side.anomaly_desc = f"WRONG CAMPUS EXIT VIOLATION: Checked in at {active_campus_norm.upper()} (at {check_in_time})! Cannot exit from {current_campus_norm.upper()}."
                                reason_text = f"Exited the wrong campus: Checked in at {active_campus_norm}, attempted exit at {current_campus_norm}"
                                try:
                                    supabase.table('vehicle_log').insert({
                                        "vehicle_information_id": side.vehicle_data.get('vehicle_information_id') or reg.get('vehicle_information_id') or 1,
                                        "registration_id": reg['registration_id'],
                                        "check_in": datetime.now().isoformat(),
                                        "check_out": datetime.now().isoformat(),
                                        "logged_status": "Denied",
                                        "sticker_status": "registered",
                                        "campus_gate": current_gate,
                                        "campus": current_campus_norm,
                                        "reason": reason_text
                                    }).execute()
                                except: pass

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
                            else:
                                latest_scanned_details = {
                                    "gate": "ENTRANCE" if side.type == 'in' else "EXIT",
                                    "name": driver_name,
                                    "role": role_name,
                                    "plate": v_plate,
                                    "brand": full_brand,
                                    "type": v_type,
                                    "status": "REGISTERED",
                                    "time": datetime.now().strftime("%I:%M:%S %p")
                                }
                                side.state = GateState.DETECTED
                        else:
                            latest_scanned_details = {
                                "gate": "ENTRANCE" if side.type == 'in' else "EXIT",
                                "name": driver_name,
                                "role": role_name,
                                "plate": v_plate,
                                "brand": full_brand,
                                "type": v_type,
                                "status": "REGISTERED",
                                "time": datetime.now().strftime("%I:%M:%S %p")
                            }
                            side.state = GateState.DETECTED
                    else:
                        side.state = GateState.INVALID_QR
                        side.data = reg_id
                except Exception as e:
                    side.state = GateState.API_ERROR
                    side.api_error = f"Lookup failed: {str(e)}"
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
                                
                                # Close open vehicle_log row
                                try:
                                    all_logs = supabase.table('vehicle_log').select('vehicle_log_id, check_out').eq('registration_id', reg_id).execute()
                                    open_rows = [r for r in (all_logs.data or []) if not r.get('check_out')]
                                    if open_rows:
                                        for row in open_rows:
                                            supabase.table('vehicle_log').update({
                                                "check_out": current_time,
                                                "logged_status": "exited_campus"
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
                                            "campus": norm_campus_name
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
                                
                                # Close open vehicle_log row
                                try:
                                    all_logs = supabase.table('vehicle_log').select('vehicle_log_id, check_out').eq('registration_id', reg_id).execute()
                                    open_rows = [r for r in (all_logs.data or []) if not r.get('check_out')]
                                    if open_rows:
                                        for row in open_rows:
                                            supabase.table('vehicle_log').update({
                                                "check_out": current_time,
                                                "logged_status": "exited_campus"
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
                                            "campus": norm_campus_name
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
    if active_side.state == GateState.PROCESSING:
        draw_text(display, "PROCESSING...", (25, 80), 0.8, (255, 255, 0), 2)
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