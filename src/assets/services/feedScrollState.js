// Módulo compartido: guarda el ID del primer post visible + su offset desde el tope del contenedor
// Al volver a Feed, Home.jsx restaura scrolleando exactamente hasta ese post + offset

let _postId = null;
let _offset = 0;

export function getSavedFeedScroll() {
  return { postId: _postId, offset: _offset };
}

export function setSavedFeedScroll(postId, offset) {
  _postId = postId;
  _offset = offset;
}

export function clearSavedFeedScroll() {
  _postId = null;
  _offset = 0;
}
