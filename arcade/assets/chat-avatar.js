function makeChatAvatar(username, avatar) {
  const picture = document.createElement('span');
  picture.className = 'chat-avatar';
  picture.setAttribute('aria-hidden', 'true');
  picture.textContent = username[0]?.toUpperCase() || '?';
  if (avatar) {
    const image = document.createElement('img');
    image.alt = '';
    image.addEventListener('error', () => image.remove(), {once:true});
    image.src = avatar;
    picture.append(image);
  }
  return picture;
}
