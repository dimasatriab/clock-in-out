export function reduceKiosk(phase, event) {
  const current = phase || 'scanning';
  if (current === 'scanning' && event?.type === 'match') {
    return { phase: 'confirming', name: event.name || '', open: Boolean(event.open) };
  }
  if (current === 'confirming' && event?.type === 'timeout') return { phase: 'scanning' };
  if (current === 'confirming' && event?.type === 'clock_in') {
    return { phase: 'confirmed', action: 'in', name: event.name || '', time: event.time || '' };
  }
  if (current === 'confirming' && event?.type === 'clock_out') {
    return { phase: 'confirmed', action: 'out', name: event.name || '', time: event.time || '' };
  }
  if (current === 'confirmed' && event?.type === 'done') return { phase: 'scanning' };
  return { phase: current, ignored: true };
}

export function confirmedLabel(action, name, time) {
  const verb = action === 'out' ? 'Clock Out' : 'Clock In';
  return `${verb} Confirmed — ${name} | ${time}`;
}
