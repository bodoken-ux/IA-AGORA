// ==========================================
// 1. SISTEMA DE VOZ FEMENINA
// ==========================================
let voiceMuted = false;
let agoraVoice = null;

function loadVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    const femaleNames = ['monica', 'helena', 'laura', 'paulina', 'sabina', 'lucia', 'conchita', 'victoria'];
    
    let selectedVoice = voices.find(v => v.lang.includes('es') && femaleNames.some(name => v.name.toLowerCase().includes(name)));
    if (!selectedVoice) selectedVoice = voices.find(v => v.lang.includes('es') && v.name.toLowerCase().includes('google'));
    if (!selectedVoice) selectedVoice = voices.find(v => v.lang.includes('es'));

    agoraVoice = selectedVoice || voices[0];
}

if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
}

function speakAgora(text) {
    if (voiceMuted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const cleanText = text.replace(/[*_#\[\]]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    if (agoraVoice) utterance.voice = agoraVoice;
    utterance.lang = 'es-ES';
    utterance.pitch = 1.1; 
    utterance.rate = 1.05; 

    window.speechSynthesis.speak(utterance);
}

window.toggleVoice = function() {
    voiceMuted = !voiceMuted;
    const btn = document.getElementById('mute-btn');
    if (voiceMuted) {
        btn.innerText = "🔇 VOZ: SILENCIADA";
        btn.style.color = "#94a3b8"; 
        btn.style.borderColor = "#334155";
        window.speechSynthesis.cancel();
    } else {
        btn.innerText = "🔊 VOZ: ACTIVADA";
        btn.style.color = "var(--gold)"; 
        btn.style.borderColor = "var(--gold)";
    }
};


// ==========================================
// 2. SISTEMA DE CHAT CON MEMORIA (HISTORIAL)
// ==========================================
let conversationHistory = []; // Aquí guardamos el hilo de la conversación

document.getElementById('input-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    if (window.speechSynthesis) window.speechSynthesis.cancel();

    appendMessage('user', text);
    input.value = '';
    input.disabled = true;
    
    const loadingId = appendMessage('system', 'Analizando las opciones del manual...');

    try {
        const response = await fetch('/.netlify/functions/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: text,
                history: conversationHistory // Le enviamos a Netlify lo que hemos hablado antes
            })
        });
        
        const data = await response.json();
        removeMessage(loadingId);
        
        if (data.reply) {
            appendMessage('system', data.reply);
            speakAgora(data.reply); 

            // Guardamos esta interacción en la memoria
            conversationHistory.push({ role: "user", parts: [{ text: text }] });
            conversationHistory.push({ role: "model", parts: [{ text: data.reply }] });
            
            // Borramos los mensajes más antiguos si pasamos de 4 (para ahorrar tokens y no confundirla)
            if (conversationHistory.length > 4) {
                conversationHistory.splice(0, 2);
            }

        } else {
            const errorMsg = 'Error: Respuesta vacía del oráculo.';
            appendMessage('system', errorMsg);
            speakAgora(errorMsg); 
        }
        
    } catch (error) {
        removeMessage(loadingId);
        const redMsg = 'Error de conexión con la red principal.';
        appendMessage('system', redMsg);
        speakAgora(redMsg); 
    }

    input.disabled = false;
    input.focus();
});


// ==========================================
// 3. INTERFAZ GRÁFICA
// ==========================================
function appendMessage(role, text) {
    const chatBox = document.getElementById('chat-box');
    const div = document.createElement('div');
    const id = 'msg-' + Date.now();
    div.id = id;
    div.className = `message ${role}`;
    
    if (role === 'system') {
        const formattedText = text.replace(/\n/g, '<br>');
        div.innerHTML = `<strong>ÁGORA:</strong> ${formattedText}`;
    } else {
        div.innerText = text;
    }
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}