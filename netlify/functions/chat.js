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
         return { statusCode: 200, headers, body: JSON.stringify({ reply: "ERROR: Falta la API Key." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const userMessage = body.message.toLowerCase();

        // 1. EXTRAER TEXTO DE TODOS LOS PDFs
        const pdfFolder = path.join(__dirname, 'pdfs');
        let fullText = "";
        
        if (fs.existsSync(pdfFolder)) {
            const files = fs.readdirSync(pdfFolder).filter(file => file.toLowerCase().endsWith('.pdf'));
            for (const file of files) {
                const dataBuffer = fs.readFileSync(path.join(pdfFolder, file));
                const data = await pdf(dataBuffer);
                fullText += data.text + "\n";
            }
        }

        // 2. SISTEMA DE BÚSQUEDA (RAG SIMPLE)
        // Dividimos el texto en párrafos o bloques de ~1000 caracteres
        const chunks = fullText.split(/\n\n+/); 
        
        // Buscamos las palabras clave de la pregunta del usuario
        const keywords = userMessage.split(' ').filter(w => w.length > 3);
        
        // Filtramos solo los bloques que contienen alguna palabra clave
        let relevantContext = chunks
            .filter(chunk => {
                const chunkLower = chunk.toLowerCase();
                return keywords.some(word => chunkLower.includes(word));
            })
            .slice(0, 10) // Nos quedamos solo con los 10 fragmentos más importantes
            .join("\n---\n");

        // Si no encontramos nada específico, enviamos un resumen inicial
        if (!relevantContext) {
            relevantContext = fullText.substring(0, 3000); 
        }

        // 3. INSTRUCCIONES DE SISTEMA
        const systemInstruction = `
        Eres IA-AGORA. Responde usando SOLO los fragmentos de documentos proporcionados.
        Sintetiza la respuesta pero no inventes nada. 
        Si el dato no está en estos fragmentos, di que no lo sabes.

        FRAGMENTOS RELEVANTES DE LOS DOCUMENTOS:
        ${relevantContext}
        `;

        // 4. LLAMADA A GEMINI
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: userMessage }] }],
                generationConfig: { temperature: 0.1 } 
            })
        });

        const data = await response.json();
        
        if (data.candidates && data.candidates[0].content) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: data.candidates[0].content.parts[0].text }) };
        } else {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: "No he encontrado datos exactos en los documentos." }) };
        }

    } catch (error) {
        return { statusCode: 200, headers, body: JSON.stringify({ reply: "Error procesando los archivos." }) };
    }
};