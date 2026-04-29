document.getElementById('input-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('user-input');
    const chatBox = document.getElementById('chat-box');
    const text = input.value.trim();
    if (!text) return;

    // Mensaje usuario
    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    userDiv.innerText = text;
    chatBox.appendChild(userDiv);
    
    input.value = '';
    const loadingId = 'loading-' + Date.now();
    const loadDiv = document.createElement('div');
    loadDiv.id = loadingId;
    loadDiv.className = 'message system';
    loadDiv.innerHTML = '<strong>ÁGORA:</strong> Buscando en los archivos...';
    chatBox.appendChild(loadDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const res = await fetch('/.netlify/functions/chat', {
            method: 'POST',
            body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        document.getElementById(loadingId).remove();
        
        const sysDiv = document.createElement('div');
        sysDiv.className = 'message system';
        sysDiv.innerHTML = `<strong>ÁGORA:</strong> ${data.reply}`;
        chatBox.appendChild(sysDiv);
    } catch (e) {
        document.getElementById(loadingId).innerText = 'Error de conexión.';
    }
    chatBox.scrollTop = chatBox.scrollHeight;
});