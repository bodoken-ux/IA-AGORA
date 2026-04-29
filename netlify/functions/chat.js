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
        const userMessage = body.message.toLowerCase();

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
                fullText += data.text + "\n";
            }
        }

        if (fullText.trim() === "") {
             return { statusCode: 200, headers, body: JSON.stringify({ reply: "Los PDFs están vacíos o son imágenes escaneadas sin texto digital." }) };
        }

        // 2. SISTEMA DE BÚSQUEDA INTELIGENTE CON PUNTUACIÓN (SCORING)
        // Dividimos el texto en fragmentos
        const chunks = fullText.split(/\n\n+/); 
        
        // Sacamos las palabras clave de la pregunta (ignorando palabras muy cortas como "el", "la", "de")
        const keywords = userMessage.split(/\W+/).filter(w => w.length > 3);
        
        // Evaluamos cada fragmento y le damos puntos
        const scoredChunks = chunks.map(chunk => {
            let score = 0;
            const chunkLower = chunk.toLowerCase();
            
            keywords.forEach(word => {
                // Contamos cuántas veces aparece cada palabra clave en este fragmento
                const regex = new RegExp(word, 'g');
                const matches = chunkLower.match(regex);
                if (matches) {
                    score += matches.length; // Suma 1 punto por cada coincidencia
                }
            });
            
            return { text: chunk, score: score };
        });

        // Filtramos los que tienen 0 puntos, ordenamos de mayor a menor puntuación y nos quedamos los 8 mejores
        let relevantContext = scoredChunks
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8) 
            .map(c => c.text)
            .join("\n---\n");

        // Si no encuentra nada, le pasamos el principio de los documentos para que pueda al menos saludar o saber de qué va
        if (!relevantContext) {
            relevantContext = fullText.substring(0, 3000); 
        }

        // 3. INSTRUCCIONES ESTRICTAS PARA LA IA
        const systemInstruction = `
        Eres IA-AGORA, un oráculo culto y preciso.
        
        REGLAS:
        1. Responde a la pregunta usando SOLO la información de los FRAGMENTOS proporcionados abajo.
        2. Sintetiza la información de forma elegante.
        3. NO INVENTES NADA. Si la respuesta no está en los fragmentos, di: "Lo lamento, buscador. Esa información no consta en los archivos indexados."

        FRAGMENTOS MÁS RELEVANTES EXTRAÍDOS:
        ${relevantContext}
        `;

        // 4. LLAMADA A GEMINI
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: userMessage }] }],
                generationConfig: { temperature: 0.1 } // Temperatura baja para no alucinar
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.error) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `ERROR: ${data.error?.message}` }) };
        }

        if (data.candidates && data.candidates[0].content) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: data.candidates[0].content.parts[0].text }) };
        } else if (data.candidates && data.candidates[0].finishReason) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `La respuesta fue bloqueada por filtros de seguridad.` }) };
        } else {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `Error de conexión. Respuesta vacía.` }) };
        }

    } catch (error) {
        return { statusCode: 200, headers, body: JSON.stringify({ reply: `Error del servidor: ${error.message}` }) };
    }
};