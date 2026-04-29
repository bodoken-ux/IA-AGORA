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
    if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
         return { statusCode: 200, headers, body: JSON.stringify({ reply: "ERROR: Falta la API Key de Gemini en el servidor." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const userMessage = body.message;

        // 1. LEER LOS PDFs DE LA CARPETA
        const pdfFolder = path.join(__dirname, 'pdfs');
        let contextoPDF = "";
        
        if (fs.existsSync(pdfFolder)) {
            const files = fs.readdirSync(pdfFolder).filter(file => file.toLowerCase().endsWith('.pdf'));
            for (const file of files) {
                const dataBuffer = fs.readFileSync(path.join(pdfFolder, file));
                const data = await pdf(dataBuffer);
                contextoPDF += `\n--- INICIO DEL DOCUMENTO: ${file} ---\n${data.text}\n--- FIN DEL DOCUMENTO: ${file} ---\n`;
            }
        }

        if (!contextoPDF) {
            contextoPDF = "No hay documentos disponibles en el archivo histórico.";
        }

        // 2. INSTRUCCIONES DE SISTEMA (Sintetizar sin inventar)
        const systemInstruction = `
        Eres IA-AGORA, un oráculo de conocimiento sereno, culto y preciso.
        
        REGLAS ESTRICTAS:
        1. Tu única fuente de verdad son los DOCUMENTOS DEL ÁGORA proporcionados abajo.
        2. Tienes libertad para sintetizar, resumir y redactar la respuesta de forma natural, estructurada y elegante.
        3. NUNCA debes inventar, deducir o agregar datos, nombres, fechas o hechos que no estén explícitamente en los textos.
        4. Si la consulta del usuario NO puede responderse con la información de los documentos, responde exactamente esto: "Lo lamento, buscador. Esa información no se encuentra en mis registros actuales." No intentes adivinar.
        
        DOCUMENTOS DEL ÁGORA:
        ${contextoPDF}
        `;

        // 3. LLAMADA A GEMINI
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: userMessage }] }],
                generationConfig: { 
                    temperature: 0.2, // Lo justo para redactar bien, pero muy bajo para no alucinar datos
                    topK: 10,
                    topP: 0.8
                }
            })
        });

        const data = await response.json();

        if (data.candidates && data.candidates[0].content) {
            const reply = data.candidates[0].content.parts[0].text;
            return { statusCode: 200, headers, body: JSON.stringify({ reply: reply }) };
        } else {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: "El oráculo no ha podido procesar la solicitud." }) };
        }

    } catch (error) {
        console.error(error);
        return { statusCode: 200, headers, body: JSON.stringify({ reply: "Se ha perdido la conexión con los archivos del Ágora." }) };
    }
};