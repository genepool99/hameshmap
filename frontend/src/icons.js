// Static SVG markup for markers and buttons. Contains no user data.
const SHAPES = {
  client: '<circle cx="12" cy="12" r="8"/>',
  repeater: '<path d="M12 3 21.5 20h-19z"/>',
  room_server: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
  sensor: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
  unknown: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>',
  companion: '<path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21.1l1.6-7L2 9.3l7.1-.7z"/>',
};

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

// Marker shape for a node type or "companion".
export const shapeSvg = (type) => svg(SHAPES[type] || SHAPES.unknown);

export const ICONS = {
  menu: svg('<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>'),
  list: svg('<path d="M3 5h2v2H3zm4 0h14v2H7zM3 11h2v2H3zm4 0h14v2H7zM3 17h2v2H3zm4 0h14v2H7z"/>'),
  close: svg('<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/>'),
  fit: svg('<path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/>'),
};
