const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "OK" };

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
         return { statusCode: 200, headers, body: JSON.stringify({ reply: "Falta la API Key en Netlify." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const userMessage = body.message;

        // Función para normalizar texto (Quita tildes y lo pone en minúsculas)
        const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        // 1. LEER TODOS LOS PDFs
        let pdfFolder = path.join(__dirname, 'pdfs');
        if (!fs.existsSync(pdfFolder)) {
            pdfFolder = path.join(process.cwd(), 'netlify/functions/pdfs');
        }

        let fullText = "";
        if (fs.existsSync(pdfFolder)) {
            const files = fs.readdirSync(pdfFolder).filter(file => file.toLowerCase().endsWith('.pdf'));
            for (const file of files) {
                const dataBuffer = fs.readFileSync(path.join(pdfFolder, file));
                const data = await pdf(dataBuffer);
                // Ponemos una marca para saber de qué manual viene
                fullText += `\n--- MANUAL: ${file} ---\n` + data.text + "\n";
            }
        }

        if (fullText.trim() === "") {
             return { statusCode: 200, headers, body: JSON.stringify({ reply: "Los manuales están vacíos o son imágenes escaneadas." }) };
        }

        // 2. CHUNKING CON SOLAPAMIENTO (Para no cortar instrucciones a medias)
        const lines = fullText.split(/\n/);
        let chunks = [];
        let currentChunk = "";
        
        for (const line of lines) {
            if (line.trim() === "") continue;
            currentChunk += line + " "; // Vamos sumando líneas
            
            // Cuando el trozo tiene unos 1200 caracteres, lo guardamos
            if (currentChunk.length > 1200) {
                chunks.push(currentChunk);
                // Mantenemos los últimos 300 caracteres para el siguiente bloque (Solapamiento)
                currentChunk = currentChunk.substring(currentChunk.length - 300);
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        // 3. BÚSQUEDA INTELIGENTE
        const normalizedMessage = normalize(userMessage);
        // Sacamos palabras clave de más de 3 letras
        let keywords = normalizedMessage.split(/\W+/).filter(w => w.length > 3);
        
        if (keywords.length === 0) {
            // Si el usuario pone algo muy corto como "TPV", lo usamos entero
            keywords = [normalizedMessage.trim()];
        }

        const scoredChunks = chunks.map(chunk => {
            let score = 0;
            const normalizedChunk = normalize(chunk);
            
            keywords.forEach(word => {
                // Truco para manuales: Quitamos la 's' final para que "facturas" coincida con "factura"
                const root = word.endsWith('s') ? word.slice(0, -1) : word;
                const regex = new RegExp(root, 'g');
                const matches = normalizedChunk.match(regex);
                if (matches) {
                    score += matches.length; 
                }
            });
            
            return { text: chunk, score: score };
        });

        // Nos quedamos con los 10 bloques con más información sobre la pregunta
        let relevantContext = scoredChunks
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10) 
            .map(c => c.text)
            .join("\n\n[...]\n\n"); // Separador claro para la IA

        if (!relevantContext) {
            relevantContext = fullText.substring(0, 3000); 
        }

        // 4. INSTRUCCIONES PARA LA IA (Orientadas a Manuales Técnicos)
        const systemInstruction = `
        Eres IA-AGORA, un asistente técnico experto en el software Ágora.
        
        REGLAS ESTRICTAS:
        1. Tu objetivo es explicar cómo hacer cosas en el programa basándote EXCLUSIVAMENTE en los fragmentos del manual proporcionados.
        2. Si la respuesta implica pasos (1, 2, 3...), formatea tu respuesta en una lista clara o viñetas.
        3. NO INVENTES opciones, botones ni menús que no estén en el texto.
        4. Si te preguntan algo que no aparece en los fragmentos, responde EXACTAMENTE: "Lo lamento, buscador. No encuentro el procedimiento exacto en los manuales de Ágora que he indexado."

        FRAGMENTOS DEL MANUAL:
        ${relevantContext}
        `;

        // 5. LLAMADA A GEMINI
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: userMessage }] }],
                generationConfig: { temperature: 0.1 } // Muy bajo para que sea estrictamente técnico
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.error) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `ERROR: ${data.error?.message}` }) };
        }

        if (data.candidates && data.candidates[0].content) {
            const replyText = data.candidates[0].content.parts[0].text;
            return { statusCode: 200, headers, body: JSON.stringify({ reply: replyText }) };
        } else {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `Error o respuesta bloqueada por seguridad.` }) };
        }

    } catch (error) {
        return { statusCode: 200, headers, body: JSON.stringify({ reply: `Error del servidor: ${error.message}` }) };
    }
};