// ==========================================
// 1. SISTEMA DE VOZ FEMENINA (EL ORÁCULO)
// ==========================================
let voiceMuted = false;
let agoraVoice = null;

function loadVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    
    // Buscamos nombres de voces femeninas comunes en español
    const femaleNames = ['monica', 'helena', 'laura', 'paulina', 'sabina', 'lucia', 'conchita', 'victoria'];
    
    let selectedVoice = voices.find(v => 
        v.lang.includes('es') && femaleNames.some(name => v.name.toLowerCase().includes(name))
    );

    // Si no encuentra los nombres, busca la de Google en español
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.includes('es') && v.name.toLowerCase().includes('google'));
    }

    // Si todo falla, coge la primera que pille en español
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.includes('es'));
    }

    agoraVoice = selectedVoice || voices[0];
}

// Cargar las voces nada más abrir la web
if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
}

function speakAgora(text) {
    if (voiceMuted || !window.speechSynthesis) return;
    
    window.speechSynthesis.cancel(); // Detiene si ya estaba hablando
    
    // Limpiamos el texto de asteriscos y corchetes para que lo lea de forma natural
    const cleanText = text.replace(/[*_#\[\]]/g, '');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    if (agoraVoice) utterance.voice = agoraVoice;
    
    utterance.lang = 'es-ES';
    utterance.pitch = 1.1; // Tono ligeramente agudo y femenino
    utterance.rate = 1.05; // Velocidad fluida y dinámica
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
}

// Función del botón silenciar de la cabecera
window.toggleVoice = function() {
    voiceMuted = !voiceMuted;
    const btn = document.getElementById('mute-btn');
    if (voiceMuted) {
        btn.innerText = "🔇 VOZ: SILENCIADA";
        btn.style.color = "#94a3b8"; // Gris apagado
        btn.style.borderColor = "#334155";
        window.speechSynthesis.cancel(); // Calla a la IA al instante
    } else {
        btn.innerText = "🔊 VOZ: ACTIVADA";
        btn.style.color = "var(--gold)"; // Vuelve al oro
        btn.style.borderColor = "var(--gold)";
    }
};


// ==========================================
// 2. SISTEMA DE CHAT Y CONEXIÓN CON NETLIFY
// ==========================================
document.getElementById('input-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    // 1. Callamos cualquier voz anterior al hacer una nueva pregunta
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // 2. Mostramos lo que preguntó el usuario
    appendMessage('user', text);
    input.value = '';
    input.disabled = true;
    
    // 3. Mostramos mensaje de "Cargando..."
    const loadingId = appendMessage('system', 'Consultando los archivos del Ágora...');

    try {
        // 4. Enviamos la pregunta al backend (chat.js en Netlify)
        const response = await fetch('/.netlify/functions/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();
        removeMessage(loadingId); // Quitamos el "Cargando..."
        
        // 5. Mostramos y leemos la respuesta
        if (data.reply) {
            appendMessage('system', data.reply);
            speakAgora(data.reply); // La IA habla
        } else {
            const errorMsg = 'Error: Respuesta vacía del oráculo.';
            appendMessage('system', errorMsg);
            speakAgora(errorMsg); 
        }
        
    } catch (error) {
        // Si hay error de servidor (o si lo pruebas en local sin Netlify)
        removeMessage(loadingId);
        const redMsg = 'Atención. Error de conexión con la red principal o el servidor local.';
        appendMessage('system', redMsg);
        speakAgora(redMsg); 
    }

    // 6. Volvemos a activar la barra de escritura
    input.disabled = false;
    input.focus();
});


// ==========================================
// 3. FUNCIONES PARA DIBUJAR LOS MENSAJES
// ==========================================
function appendMessage(role, text) {
    const chatBox = document.getElementById('chat-box');
    const div = document.createElement('div');
    const id = 'msg-' + Date.now();
    div.id = id;
    div.className = `message ${role}`;
    
    if (role === 'system') {
        // Convertimos los saltos de línea de la IA en etiquetas <br> para que separe los párrafos
        const formattedText = text.replace(/\n/g, '<br>');
        div.innerHTML = `<strong>ÁGORA:</strong> ${formattedText}`;
    } else {
        div.innerText = text;
    }
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll hacia abajo
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}