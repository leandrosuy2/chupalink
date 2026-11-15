(function () {
  const $ = (id) => document.getElementById(id);
  let token = sessionStorage.getItem('chupalink_token') || '';
  let socket;

  function render(s) {
    $('status').textContent = s.status;
    $('status').className = 'status ' + s.status;
    $('qrBox').classList.toggle('hidden', s.status !== 'QR_CODE');
    const lines = [];
    if (s.user) lines.push('Conectado como ' + (s.user.name || '') + ' (' + s.user.id.split(':')[0].split('@')[0] + ')');
    if (s.status === 'LOGGED_OUT') lines.push('Sessão encerrada — clique em Conectar para gerar um novo QR Code.');
    if (s.lastDisconnect && s.status !== 'CONNECTED') lines.push('Última queda: ' + s.lastDisconnect.reason);
    $('info').textContent = lines.join(' · ');
  }

  async function api(method, path) {
    const res = await fetch('/api' + path, { method, headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) { logout(); throw new Error('Token inválido'); }
    return res.json();
  }

  function logout() {
    sessionStorage.removeItem('chupalink_token');
    if (socket) socket.disconnect();
    $('panel').classList.add('hidden');
    $('login').classList.remove('hidden');
  }

  function start() {
    $('login').classList.add('hidden');
    $('panel').classList.remove('hidden');
    socket = io({ auth: { token } });
    socket.on('connect_error', (e) => { if (e.message === 'unauthorized') { alert('Token inválido'); logout(); } });
    socket.on('whatsapp.status', render);
    socket.on('whatsapp.connected', render);
    socket.on('whatsapp.qr', (q) => { $('qr').src = q.dataUrl; $('qrBox').classList.remove('hidden'); });
    socket.on('job.update', (j) => { $('jobs').textContent = 'Última tarefa: ' + j.platform + ' → ' + j.status; });
  }

  $('enter').onclick = () => {
    token = $('token').value.trim();
    if (!token) return;
    sessionStorage.setItem('chupalink_token', token);
    start();
  };
  $('connect').onclick = () => api('POST', '/whatsapp/connect').then(render).catch(() => {});
  $('disconnect').onclick = () => api('POST', '/whatsapp/disconnect').then(render).catch(() => {});
  if (token) start();
})();
