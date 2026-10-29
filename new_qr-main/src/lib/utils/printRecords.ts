import { showAlert } from './dialog';

// Printable A4 table of registered vehicles, opened in a new window with the browser's print dialog.

export interface RegisteredVehicleRow {
    regNo: string | number;
    name: string;
    role?: string | null;
    department?: string | null;
    campus?: string | null;
    plate?: string | null;
    vehicle?: string | null;
    type?: string | null;
    expires?: string | null;
}

function esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function niceType(t?: string | null): string {
    if (!t) return '—';
    if (/^2/.test(t)) return '2 Wheels';
    if (/^4/.test(t)) return '4 Wheels';
    return t.replace(/_/g, ' ');
}

function niceDate(d?: string | null): string {
    if (!d) return '—';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

function cap(s?: string | null): string {
    return s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}

export function printRegisteredVehicles(rows: RegisteredVehicleRow[], preparedBy: string, office: string) {
    if (rows.length === 0) {
        showAlert('Select at least one registered vehicle to print.', { tone: 'info', title: 'Nothing selected' });
        return;
    }
    const win = window.open('', '_blank', 'width=1000,height=760');
    if (!win) {
        showAlert('The print window was blocked. Please allow pop-ups for this site and try again.');
        return;
    }

    const generated = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const body = rows
        .map((r, i) => `<tr>
            <td class="num">${i + 1}</td>
            <td class="reg">${esc(r.regNo)}</td>
            <td><strong>${esc(r.name)}</strong></td>
            <td>${esc(cap(r.role))}</td>
            <td>${esc(r.department || '—')}</td>
            <td>${esc(r.campus || '—')}</td>
            <td class="plate">${esc((r.plate || '—').toUpperCase())}</td>
            <td>${esc(r.vehicle || '—')}</td>
            <td>${esc(niceType(r.type))}</td>
            <td>${esc(niceDate(r.expires))}</td>
        </tr>`)
        .join('');

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Registered Vehicles - GateQR</title>
<style>
  @page { size: A4 landscape; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1A0A0E; margin: 0; padding: 18px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #8B1A3C; padding-bottom: 10px; margin-bottom: 14px; }
  .uni { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #92400E; }
  h1 { margin: 2px 0 0; font-size: 20px; color: #6B1A2A; }
  .meta { text-align: right; font-size: 11px; color: #5C3A42; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead th { background: #8B1A3C; color: #fff; text-align: left; padding: 7px 6px; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  tbody td { padding: 7px 6px; border-bottom: 1px solid #ecdfe3; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fbf7f8; }
  td.num { color: #8B6A72; width: 26px; }
  td.reg { font-weight: 800; color: #8B1A3C; white-space: nowrap; }
  td.plate { font-family: Consolas, monospace; font-weight: 700; white-space: nowrap; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 18px; display: flex; justify-content: space-between; font-size: 10px; color: #8B6A72; }
  .sign { margin-top: 36px; width: 240px; border-top: 1px solid #1A0A0E; padding-top: 4px; font-size: 11px; text-align: center; color: #1A0A0E; }
  .toolbar { margin-bottom: 14px; display: flex; gap: 8px; }
  .toolbar button { padding: 8px 16px; border-radius: 8px; border: 1px solid #8B1A3C; background: #8B1A3C; color: #fff; font-weight: 700; cursor: pointer; }
  .toolbar button.secondary { background: #fff; color: #8B1A3C; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print</button><button class="secondary" onclick="window.close()">Close</button></div>
  <header>
    <div>
      <div class="uni">Liceo de Cagayan University · ${esc(office)}</div>
      <h1>Registered Vehicles Record</h1>
    </div>
    <div class="meta">Generated: ${esc(generated)}<br>Prepared by: ${esc(preparedBy)}<br>Total vehicles: <strong>${rows.length}</strong></div>
  </header>
  <table>
    <thead><tr><th>#</th><th>Reg. No.</th><th>Name</th><th>Role</th><th>Department</th><th>Campus</th><th>Plate</th><th>Vehicle</th><th>Type</th><th>Sticker Expiry</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="sign">Signature over printed name</div>
  <footer><span>GateQR Vehicle Sticker Portal</span><span>Confidential: for official use only</span></footer>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });<\/script>
</body>
</html>`);
    win.document.close();
}
