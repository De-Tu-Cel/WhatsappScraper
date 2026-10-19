"""Allowlisted operational evidence, without message bodies or credentials."""
import math


def sanitize_diagnostics(value):
    if not isinstance(value, dict):
        return None
    result = {}
    def numbers(source, names):
        return {k: v for k in names if isinstance((v := source.get(k)), (int, float))
                and not isinstance(v, bool) and math.isfinite(v) and abs(v) < 10 ** 15}
    result.update(numbers(value, ('heartbeat_failures', 'service_memory_mb', 'host_available_memory_mb')))
    for name in ('event_id', 'captured_at'):
        if isinstance(value.get(name), str):
            result[name] = value[name][:64]
    for name, keys in [('session_memory', ('memory_mb', 'processes')),
                       ('browser_process', ('pid', 'exit_code'))]:
        if isinstance(value.get(name), dict):
            result[name] = numbers(value[name], keys)
    process = value.get('browser_process')
    if isinstance(process, dict) and process.get('signal') in ('SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV'):
        result['browser_process']['signal'] = process['signal']
    loads = value.get('host_load_average')
    if isinstance(loads, list) and len(loads) == 3 and all(
            isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v < 10 ** 6 for v in loads):
        result['host_load_average'] = loads
    activity = value.get('activity')
    if isinstance(activity, dict):
        result['activity'] = numbers(activity, ('queued', 'deferred'))
        operation = activity.get('operation')
        if isinstance(operation, str):
            result['activity']['operation'] = operation[:64]
        if isinstance(activity.get('last_operation'), str):
            result['activity']['last_operation'] = activity['last_operation'][:64]
        finished = activity.get('last_finished_at')
        if isinstance(finished, str):
            result['activity']['last_finished_at'] = finished[:40]
    error = value.get('last_error')
    if isinstance(error, dict):
        result['last_error'] = {k: error[k][:64] for k in ('source', 'at', 'code') if isinstance(error.get(k), str)}
    return result
