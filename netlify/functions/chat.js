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
         return { statusCode: 200, headers, body: JSON.stringify({ reply: "DIAGNÓSTICO: Falta la API Key." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const userMessage = body.message.toLowerCase();

        // 1. EXTRAER TEXTO DE TODOS LOS PDFs
        // En Netlify, a veces __dirname cambia. Usamos process.cwd() como respaldo.
        let pdfFolder = path.join(__dirname, 'pdfs');
        if (!fs.existsSync(pdfFolder)) {
            pdfFolder = path.join(process.cwd(), 'netlify/functions/pdfs');
        }

        let fullText = "";
        
        if (fs.existsSync(pdfFolder)) {
            const files = fs.readdirSync(pdfFolder).filter(file => file.toLowerCase().endsWith('.pdf'));
            if (files.length === 0) {
                 return { statusCode: 200, headers, body: JSON.stringify({ reply: "DIAGNÓSTICO: La carpeta 'pdfs' existe, pero está vacía. No hay archivos .pdf dentro." }) };
            }
            
            for (const file of files) {
                const dataBuffer = fs.readFileSync(path.join(pdfFolder, file));
                const data = await pdf(dataBuffer);
                fullText += data.text + "\n";
            }
        } else {
             return { statusCode: 200, headers, body: JSON.stringify({ reply: "DIAGNÓSTICO: El servidor no encuentra la carpeta 'pdfs'. Asegúrate de que está dentro de 'netlify/functions/'." }) };
        }

        if (fullText.trim() === "") {
             return { statusCode: 200, headers, body: JSON.stringify({ reply: "DIAGNÓSTICO: Los PDFs se han encontrado, pero el programa no pudo extraer ni una sola letra. Probablemente son imágenes escaneadas o están encriptados." }) };
        }

        // 2. SISTEMA DE BÚSQUEDA (RAG SIMPLE)
        const chunks = fullText.split(/\n\n+/); 
        const keywords = userMessage.split(' ').filter(w => w.length > 3);
        
        let relevantContext = chunks
            .filter(chunk => {
                const chunkLower = chunk.toLowerCase();
                return keywords.some(word => chunkLower.includes(word));
            })
            .slice(0, 10) 
            .join("\n---\n");

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
        
        // 5. ANÁLISIS DEL ERROR EXACTO DE GOOGLE
        if (!response.ok || data.error) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `DIAGNÓSTICO DE GOOGLE: ${data.error?.message || "Error desconocido"}` }) };
        }

        if (data.candidates && data.candidates[0].content) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: data.candidates[0].content.parts[0].text }) };
        } else if (data.candidates && data.candidates[0].finishReason) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `DIAGNÓSTICO: Google Gemini bloqueó la respuesta. Motivo: ${data.candidates[0].finishReason} (Suele ser por Filtros de Seguridad)` }) };
        } else {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `DIAGNÓSTICO DESCONOCIDO: La respuesta vino en blanco. Estructura recibida: ${JSON.stringify(data)}` }) };
        }

    } catch (error) {
        return { statusCode: 200, headers, body: JSON.stringify({ reply: `DIAGNÓSTICO FATAL: Error interno del servidor -> ${error.message}` }) };
    }
};