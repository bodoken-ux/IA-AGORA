document.getElementById('input-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    // Mostrar el mensaje del usuario
    appendMessage('user', text);
    input.value = '';
    input.disabled = true;
    
    // Mostrar mensaje de carga
    const loadingId = appendMessage('system', 'Consultando los archivos...');

    try {
        const response = await fetch('/.netlify/functions/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();
        
        // Quitar el mensaje de carga y poner la respuesta real
        removeMessage(loadingId);
        
        if (data.reply) {
            appendMessage('system', data.reply);
        } else {
            appendMessage('system', 'Error: Respuesta vacía del oráculo.');
        }
        
    } catch (error) {
        removeMessage(loadingId);
        appendMessage('system', 'Error de conexión con la red principal.');
    }

    input.disabled = false;
    input.focus();
});

function appendMessage(role, text) {
    const chatBox = document.getElementById('chat-box');
    const div = document.createElement('div');
    const id = 'msg-' + Date.now();
    div.id = id;
    div.className = `message ${role}`;
    
    if (role === 'system') {
        div.innerHTML = `<strong>ÁGORA:</strong> ${text}`;
    } else {
        div.innerText = text;
    }
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight; // Hace scroll hacia abajo automáticamente
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}