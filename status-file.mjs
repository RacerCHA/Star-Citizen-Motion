// SPDX-License-Identifier: GPL-3.0-or-later
// Diagnostics must never stop the live telemetry path. Keep the previous complete
// JSON when Windows temporarily denies replacement; retry on the next timer tick.
import fs from 'node:fs';
export function statusWriter(file, status) {
  const temp = file + '.' + process.pid + '.tmp';
  let failed = false, warnedAt = -Infinity;
  return function save() {
    try {
      status.last_status_error = null;
      fs.writeFileSync(temp, JSON.stringify(status, null, 2));
      fs.renameSync(temp, file);
      if (failed) console.error('Status file writable again: ' + file);
      failed = false;
      return true;
    } catch (error) {
      status.status_write_errors = (status.status_write_errors ?? 0) + 1;
      status.last_status_error = error.code ?? error.message;
      status.last_status_error_at = new Date().toISOString();
      if (!failed || Date.now() - warnedAt >= 60000) {
        console.error('Status write deferred; telemetry continues: ' + file + ' (' + status.last_status_error + ')');
        warnedAt = Date.now();
      }
      failed = true;
      return false;
    }
  };
}
