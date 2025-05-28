import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, serverTimestamp, setLogLevel } from 'firebase/firestore';
import { 
    ArrowUpTrayIcon, DocumentTextIcon, PuzzlePieceIcon, ShareIcon, LightBulbIcon, 
    UserCircleIcon, XMarkIcon, AcademicCapIcon, CheckCircleIcon, QuestionMarkCircleIcon, 
    ChatBubbleLeftRightIcon, PhotoIcon, SparklesIcon, BeakerIcon, DocumentArrowDownIcon // Added for PDF export
} from '@heroicons/react/24/outline'; 

// ** IMPORTANTE: Para la funcionalidad de Exportar a PDF **
// En un proyecto real, instalarías jspdf y html2canvas:
// npm install jspdf html2canvas
// Y luego los importarías:
// import jsPDF from 'jspdf';
// import html2canvas from 'html2canvas';
// Por ahora, la función de exportar asumirá que estas librerías están disponibles globalmente.

// ** IMPORTANTE: Configuración de Firebase **
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "TU_API_KEY_FIREBASE", 
    authDomain: "TU_AUTH_DOMAIN_FIREBASE",
    projectId: "TU_PROJECT_ID_FIREBASE",
    storageBucket: "TU_STORAGE_BUCKET_FIREBASE",
    messagingSenderId: "TU_MESSAGING_SENDER_ID_FIREBASE",
    appId: "TU_APP_ID_FIREBASE"
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'study-spark-ai-default';

let app;
let auth;
let db;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    // setLogLevel('debug'); 
} catch (error) {
    console.error("Error inicializando Firebase:", error);
}

const App = () => {
    const [user, setUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    const [image, setImage] = useState(null);
    const [imagePreview, setImagePreview] = useState('');
    const [extractedText, setExtractedText] = useState('');
    const [isLoadingText, setIsLoadingText] = useState(false);
    
    const [isLoadingStudyAid, setIsLoadingStudyAid] = useState(false);
    const [isLoadingMindMapImage, setIsLoadingMindMapImage] = useState(false);
    const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);
    const [isLoadingExamples, setIsLoadingExamples] = useState(false);

    const [studyAidType, setStudyAidType] = useState(''); 
    const [generatedAid, setGeneratedAid] = useState(null); 
    
    const [conceptToExplain, setConceptToExplain] = useState('');
    const [explanationResult, setExplanationResult] = useState('');
    const [examplesResult, setExamplesResult] = useState('');
    const [activeFeature, setActiveFeature] = useState(''); 

    const [userProfile, setUserProfile] = useState({
        studyLevel: 'universidad',
        language: 'es',
    });
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [currentScore, setCurrentScore] = useState(0);
    const [quizFeedback, setQuizFeedback] = useState([]);

    const fileInputRef = useRef(null);
    const exportContentRef = useRef(null); // Ref para el contenido a exportar

    const GOOGLE_AI_API_KEY = ""; // TU CLAVE API AQUÍ (o dejar vacía si Canvas la provee)

    useEffect(() => {
        if (!auth) {
            console.error("Firebase Auth no está inicializado.");
            setIsAuthReady(true); 
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                setUserId(currentUser.uid);
                await loadUserProfile(currentUser.uid);
            } else {
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Error en inicio de sesión anónimo/custom token:", error);
                }
            }
            setIsAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    const loadUserProfile = async (uid) => {
        if (!db || !uid) return;
        const profileRef = doc(db, `artifacts/${appId}/users/${uid}/profile/settings`);
        try {
            const docSnap = await getDoc(profileRef);
            if (docSnap.exists()) {
                setUserProfile(prev => ({ ...prev, ...docSnap.data() }));
            } else {
                await saveUserProfile(uid, userProfile);
            }
        } catch (error) {
            console.error("Error cargando perfil de usuario:", error);
        }
    };

    const saveUserProfile = async (uid, profileData) => {
        if (!db || !uid) return;
        const profileRef = doc(db, `artifacts/${appId}/users/${uid}/profile/settings`);
        try {
            await setDoc(profileRef, profileData, { merge: true });
            setUserProfile(profileData);
            setShowProfileModal(false);
        } catch (error) {
            console.error("Error guardando perfil de usuario:", error);
        }
    };
    
    const handleImageUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            setImage(file);
            setImagePreview(URL.createObjectURL(file));
            setExtractedText('');
            setGeneratedAid(null);
            setStudyAidType('');
            setExplanationResult('');
            setExamplesResult('');
            setConceptToExplain('');
            setActiveFeature('');
            setCurrentScore(0);
            setQuizFeedback([]);
        }
    };

    const triggerFileInput = () => {
        fileInputRef.current.click();
    };

    const extractTextFromImage = async () => {
        if (!image) {
            console.warn("Por favor, sube una imagen primero.");
            return;
        }
        setIsLoadingText(true);
        setExtractedText('');
        setExplanationResult('');
        setExamplesResult('');
        setActiveFeature('');

        const reader = new FileReader();
        reader.readAsDataURL(image);
        reader.onloadend = async () => {
            const base64ImageData = reader.result.split(',')[1];
            
            const prompt = `Extrae el texto de esta imagen. El texto es material de estudio y está en idioma ${userProfile.language}. Si detectas que es una tabla o tiene una estructura particular, intenta mantenerla.`;
            const payload = {
                contents: [{
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: image.type, data: base64ImageData } }
                    ]
                }],
            };
            
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorBody = await response.json();
                    console.error("Error de API Gemini (extracción):", errorBody);
                    throw new Error(`Error ${response.status}: ${errorBody.error?.message || response.statusText}`);
                }

                const result = await response.json();

                if (result.candidates && result.candidates.length > 0 &&
                    result.candidates[0].content && result.candidates[0].content.parts &&
                    result.candidates[0].content.parts.length > 0 && result.candidates[0].content.parts[0].text) {
                    setExtractedText(result.candidates[0].content.parts[0].text);
                } else {
                    console.warn("Respuesta inesperada de Gemini (extracción):", result);
                    let errorMessage = "No se pudo extraer texto o la respuesta no tuvo el formato esperado. Revisa la consola para más detalles.";
                     if (result.promptFeedback && result.promptFeedback.blockReason) {
                        errorMessage = `Extracción bloqueada: ${result.promptFeedback.blockReason}. ${result.promptFeedback.blockReasonMessage || ''}`;
                    }
                    setExtractedText(errorMessage);
                }
            } catch (error) {
                console.error("Error llamando a Gemini API (extracción):", error);
                setExtractedText(`Error al procesar la imagen: ${error.message}. Intenta de nuevo o revisa la consola.`);
            } finally {
                setIsLoadingText(false);
            }
        };
        reader.onerror = (error) => {
            console.error("Error leyendo el archivo:", error);
            setExtractedText("Error al leer el archivo de imagen.");
            setIsLoadingText(false);
        };
    };

    const generateMindMapImageFromDescription = async (description) => {
        setIsLoadingMindMapImage(true);
        setActiveFeature(''); 
        const imagePrompt = `Genera una imagen de un mapa mental que represente visualmente la siguiente descripción. Intenta que sea claro, organizado y visualmente atractivo. Descripción: "${description}"`;
        const payload = { 
            instances: [{ prompt: imagePrompt }],
            parameters: { "sampleCount": 1 } 
        };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GOOGLE_AI_API_KEY}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error("Error de API Imagen (generación mapa mental):", errorBody);
                throw new Error(`Error ${response.status}: ${errorBody.error?.message || response.statusText}`);
            }

            const result = await response.json();

            if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
                const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
                setGeneratedAid(imageUrl); 
            } else {
                console.warn("Respuesta inesperada de API Imagen (mapa mental):", result);
                setGeneratedAid("No se pudo generar la imagen del mapa mental o la respuesta no fue la esperada.");
            }
        } catch (error) {
            console.error("Error llamando a API Imagen (mapa mental):", error);
            setGeneratedAid(`Error al generar imagen del mapa mental: ${error.message}.`);
        } finally {
            setIsLoadingMindMapImage(false);
        }
    };


    const generateStudyAid = async (type) => {
        if (!extractedText || extractedText.toLowerCase().startsWith("error") || extractedText.toLowerCase().startsWith("no se pudo")) {
            console.warn("Primero extrae texto de una imagen de forma exitosa.");
            return;
        }
        setStudyAidType(type);
        setIsLoadingStudyAid(true);
        setGeneratedAid(null); 
        setExplanationResult(''); 
        setExamplesResult('');   
        setActiveFeature('');    
        setCurrentScore(0);
        setQuizFeedback([]);

        let prompt = "";
        let responseSchema = null;
        const basePrompt = `Eres un asistente de estudio experto. El usuario tiene un nivel de estudio '${userProfile.studyLevel}' y prefiere el contenido en '${userProfile.language}'.\n\nMaterial de estudio base:\n"""${extractedText}"""\n\n`;

        if (type === 'summary') {
            prompt = `${basePrompt}Por favor, genera un resumen conciso y claro de este material, destacando los puntos más importantes.`;
        } else if (type === 'quiz') {
            prompt = `${basePrompt}Crea un quiz interactivo de 5 preguntas de opción múltiple (con 4 opciones cada una, donde solo una es correcta) basado en el material. Para cada pregunta, indica claramente cuál es la opción correcta y proporciona una breve explicación de por qué esa respuesta es correcta.`;
            responseSchema = { 
                type: "ARRAY", description: "Un array de objetos, cada uno representando una pregunta del quiz.",
                items: {
                    type: "OBJECT", properties: {
                        question: { type: "STRING", description: "La pregunta del quiz." },
                        options: { type: "ARRAY", description: "Un array de 4 strings, representando las opciones de respuesta.", items: { type: "STRING" } },
                        correctAnswerIndex: { type: "INTEGER", description: "El índice (0-3) de la opción correcta en el array 'options'." },
                        explanation: { type: "STRING", description: "Una breve explicación de por qué la respuesta correcta es correcta."}
                    }, required: ["question", "options", "correctAnswerIndex", "explanation"]
                }
            };
        } else if (type === 'faq') {
            prompt = `${basePrompt}Genera una guía de estudio en formato de Preguntas Frecuentes (FAQ). Crea al menos 5-7 preguntas clave que un estudiante podría tener sobre este material, junto con sus respuestas concisas y claras.`;
            responseSchema = {
                type: "ARRAY",
                description: "Un array de objetos, cada uno representando una pregunta y su respuesta.",
                items: {
                    type: "OBJECT",
                    properties: {
                        question: { type: "STRING", description: "La pregunta de estudio." },
                        answer: { type: "STRING", description: "La respuesta a la pregunta." }
                    },
                    required: ["question", "answer"]
                }
            };
        } else if (type === 'mindmap_description') { 
            prompt = `${basePrompt}Describe detalladamente la estructura y contenido de un mapa mental basado en este material. Identifica el concepto central, los temas principales que se ramifican de él, y los subtemas o ideas clave para cada tema principal. Especifica las relaciones entre los conceptos. Esta descripción se usará para generar una imagen del mapa mental, así que sé muy específico sobre la jerarquía y las conexiones.`;
        }


        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            ...(responseSchema && { 
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema
                }
            })
        };
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error(`Error de API Gemini (generación ${type}):`, errorBody);
                throw new Error(`Error ${response.status}: ${errorBody.error?.message || response.statusText}`);
            }
            
            const result = await response.json();
            let aidData;

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0 && result.candidates[0].content.parts[0].text) {
                
                aidData = result.candidates[0].content.parts[0].text;

                if (type === 'mindmap_description') {
                    setIsLoadingStudyAid(false); 
                    await generateMindMapImageFromDescription(aidData);
                    return; 
                }

                if (responseSchema) { 
                  try {
                    aidData = JSON.parse(aidData);
                  } catch (e) {
                    console.error("Error parseando JSON de Gemini:", e, "Respuesta original:", aidData);
                    setGeneratedAid(`Error: La IA devolvió un texto que no es JSON válido para ${type}, aunque se esperaba. Contenido: ${aidData}`);
                    setIsLoadingStudyAid(false);
                    return; 
                  }
                }
                setGeneratedAid(aidData);

                if (db && userId) { 
                    try {
                        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/studyAids`), {
                            originalImageName: image ? image.name : 'Desconocido',
                            extractedText: extractedText.substring(0, 1000), 
                            aidType: type,
                            generatedAidOrDescription: typeof aidData === 'string' ? aidData.substring(0,1000) : aidData, 
                            studyLevel: userProfile.studyLevel,
                            language: userProfile.language,
                            createdAt: serverTimestamp(),
                            promptUsed: prompt.substring(0,1000) 
                        });
                    } catch (firestoreError) {
                        console.warn("Error guardando ayuda de estudio en Firestore:", firestoreError);
                    }
                 }

            } else { 
                console.warn(`Respuesta inesperada de Gemini (generación ${type}):`, result);
                let errorMessage = `No se pudo generar ${type} o la respuesta no tuvo el formato esperado.`;
                if (result.promptFeedback && result.promptFeedback.blockReason) {
                    errorMessage = `Generación de ${type} bloqueada: ${result.promptFeedback.blockReason}. ${result.promptFeedback.blockReasonMessage || ''}`;
                }
                setGeneratedAid(errorMessage);
            }

        } catch (error) { 
            console.error(`Error llamando a Gemini API (generación ${type}):`, error);
            setGeneratedAid(`Error al generar ${type}: ${error.message}. Intenta de nuevo o revisa la consola.`);
        }
        finally {
            if (type !== 'mindmap_description') { 
                 setIsLoadingStudyAid(false);
            }
        }
    };

    const explainKeyConcept = async () => {
        if (!extractedText || extractedText.toLowerCase().startsWith("error")) {
            setExplanationResult("Primero extrae texto de una imagen de forma exitosa.");
            return;
        }
        if (!conceptToExplain.trim()) {
            setExplanationResult("Por favor, ingresa un concepto para explicar.");
            return;
        }
        setIsLoadingExplanation(true);
        setExplanationResult('');
        setGeneratedAid(null); 
        setExamplesResult(''); 
        setActiveFeature('explanation');


        const prompt = `Eres un profesor experto. Basado en el siguiente material de estudio, explica el concepto clave "${conceptToExplain}" de forma clara y concisa. Adapta la explicación para un nivel de estudio '${userProfile.studyLevel}' y en idioma '${userProfile.language}'.\n\nMaterial de estudio:\n"""${extractedText}"""\n\nExplicación del concepto "${conceptToExplain}":`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) { const errorBody = await response.json(); throw new Error(`Error ${response.status}: ${errorBody.error?.message || response.statusText}`);}
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
                setExplanationResult(result.candidates[0].content.parts[0].text);
            } else {
                setExplanationResult("No se pudo generar la explicación para este concepto.");
            }
        } catch (error) {
            console.error("Error API (explicación concepto):", error);
            setExplanationResult(`Error al generar explicación: ${error.message}.`);
        } finally {
            setIsLoadingExplanation(false);
        }
    };

    const generatePracticalExamples = async () => {
        if (!extractedText || extractedText.toLowerCase().startsWith("error")) {
            setExamplesResult("Primero extrae texto de una imagen de forma exitosa.");
            return;
        }
        setIsLoadingExamples(true);
        setExamplesResult('');
        setGeneratedAid(null); 
        setExplanationResult(''); 
        setActiveFeature('examples');

        const prompt = `Eres un educador creativo. Basado en el siguiente material de estudio, genera 2-3 ejemplos prácticos o aplicaciones del mundo real de los conceptos principales discutidos. Haz que los ejemplos sean relevantes para un nivel de estudio '${userProfile.studyLevel}' y en idioma '${userProfile.language}'.\n\nMaterial de estudio:\n"""${extractedText}"""\n\nEjemplos Prácticos:`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) { const errorBody = await response.json(); throw new Error(`Error ${response.status}: ${errorBody.error?.message || response.statusText}`);}
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
                setExamplesResult(result.candidates[0].content.parts[0].text);
            } else {
                setExamplesResult("No se pudieron generar ejemplos prácticos para este material.");
            }
        } catch (error) {
            console.error("Error API (generar ejemplos):", error);
            setExamplesResult(`Error al generar ejemplos: ${error.message}.`);
        } finally {
            setIsLoadingExamples(false);
        }
    };

    const handleExportToPDF = async () => {
        const input = exportContentRef.current;
        if (!input) {
            console.error("Elemento para exportar no encontrado.");
            return;
        }

        // Verificar si html2canvas y jsPDF están disponibles
        if (typeof html2canvas === 'undefined' || typeof jsPDF === 'undefined') {
            console.error("html2canvas o jsPDF no están cargados. Asegúrate de incluirlos en tu proyecto.");
            alert("Error: Las librerías para generar PDF no están disponibles. Contacta al administrador.");
            return;
        }

        try {
            const canvas = await html2canvas(input, {
                scale: 2, // Aumentar escala para mejor calidad
                useCORS: true, // Si hay imágenes externas
                logging: false, 
            });
            const imgData = canvas.toDataURL('image/png');
            
            // Calcular dimensiones para el PDF
            const pdf = new jsPDF({
                orientation: 'p', // portrait
                unit: 'px', // usar pixeles para mejor mapeo
                format: [canvas.width, canvas.height] // ajustar el tamaño del pdf al canvas
            });

            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`StudySpark_Resultados_${studyAidType || activeFeature || 'export'}.pdf`);

        } catch (error) {
            console.error("Error al generar PDF:", error);
            alert("Hubo un error al generar el PDF.");
        }
    };


    const handleQuizAnswer = (questionIndex, selectedOptionIndex) => { 
        if (!generatedAid || !Array.isArray(generatedAid) || !generatedAid[questionIndex]) return;
        const correctAnswerIndex = generatedAid[questionIndex].correctAnswerIndex;
        const isCorrect = selectedOptionIndex === correctAnswerIndex;
        setQuizFeedback(prev => {
            const newFeedback = [...prev];
            newFeedback[questionIndex] = { questionIndex, correct: isCorrect, userAnswer: selectedOptionIndex, correctAnswer: correctAnswerIndex };
            return newFeedback;
        });
        if (isCorrect) { setCurrentScore(prev => prev + 1); }
    };
    const handleProfileChange = (e) => { 
        const { name, value } = e.target;
        setUserProfile(prev => ({ ...prev, [name]: value }));
    };
    const submitProfile = () => { 
        if (userId) {
            saveUserProfile(userId, userProfile);
        }
    };

    if (!isAuthReady) { 
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white p-4">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-sky-500"></div>
                <p className="ml-4 text-xl">Autenticando...</p>
            </div>
        );
    }
    
    const FaqDisplay = ({ data }) => { 
        if (!Array.isArray(data)) return <p className="text-red-500 p-4 bg-red-50 rounded-md border border-red-200">Error en datos de FAQ.</p>;
        if (data.length === 0) return <p className="text-center text-gray-500">No se generaron preguntas y respuestas.</p>;
        return (
            <div className="space-y-3">
                {data.map((item, index) => (
                    <details key={index} className="bg-slate-700 p-3 rounded-lg border border-slate-600 group">
                        <summary className="font-semibold text-sky-300 cursor-pointer group-open:text-sky-400 group-open:mb-1 text-sm">
                            {index + 1}. {item.question}
                        </summary>
                        <p className="text-slate-300 text-xs whitespace-pre-wrap pt-1">{item.answer}</p>
                    </details>
                ))}
            </div>
        );
    };
    const MindMapImageDisplay = ({ imageUrl }) => { 
        if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.toLowerCase().startsWith("error") || imageUrl.toLowerCase().startsWith("no se pudo")) {
             return <p className="text-red-500 p-4 bg-red-50 rounded-md border border-red-200 text-center">{imageUrl || "No se pudo cargar la imagen del mapa mental."}</p>;
        }
        return (
            <div className="p-2 border border-sky-700 rounded-lg bg-slate-800 shadow-lg text-center">
                <img src={imageUrl} alt="Mapa Mental Generado por IA" className="max-w-full h-auto mx-auto rounded shadow" />
                <p className="mt-2 text-xs text-slate-500">La calidad y contenido de la imagen dependen de la IA.</p>
            </div>
        );
    };


    return (
        <div className="min-h-screen bg-slate-900 text-white font-sans flex flex-col items-center p-4 sm:p-6 md:p-8">
            <header className="w-full max-w-4xl mb-8 text-center">
                 <div className="flex justify-between items-center mb-2">
                    <div className="text-xs text-sky-400">
                        {userId ? `ID Usuario: ${userId.substring(0,10)}...` : 'Modo Anónimo'}
                    </div>
                    <button
                        onClick={() => setShowProfileModal(true)}
                        className="p-2 rounded-full hover:bg-sky-700 transition-colors"
                        title="Perfil de Usuario"
                    >
                        <UserCircleIcon className="h-7 w-7 text-sky-400" />
                    </button>
                </div>
                <h1 className="text-4xl sm:text-5xl font-bold text-sky-400 flex items-center justify-center">
                    <AcademicCapIcon className="h-10 w-10 mr-3 text-sky-300" />
                    StudySpark AI
                </h1>
                <p className="text-slate-400 mt-2 text-sm sm:text-base">Transforma tus apuntes en herramientas de estudio interactivas con IA.</p>
            </header>

            {showProfileModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-800 p-6 rounded-lg shadow-2xl w-full max-w-md">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-semibold text-sky-400">Perfil de Estudio</h2>
                            <button onClick={() => setShowProfileModal(false)} className="p-1 rounded-md hover:bg-slate-700">
                                <XMarkIcon className="h-6 w-6" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="studyLevel" className="block text-sm font-medium text-sky-300 mb-1">Nivel de Estudio:</label>
                                <select
                                    id="studyLevel"
                                    name="studyLevel"
                                    value={userProfile.studyLevel}
                                    onChange={handleProfileChange}
                                    className="w-full p-2.5 bg-slate-700 border border-slate-600 rounded-md focus:ring-sky-500 focus:border-sky-500"
                                >
                                    <option value="primaria">Primaria</option>
                                    <option value="secundaria">Secundaria</option>
                                    <option value="universidad">Universidad</option>
                                    <option value="profesional">Profesional</option>
                                    <option value="autodidacta">Autodidacta (General)</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="language" className="block text-sm font-medium text-sky-300 mb-1">Idioma Preferido (para IA):</label>
                                <select
                                    id="language"
                                    name="language"
                                    value={userProfile.language}
                                    onChange={handleProfileChange}
                                    className="w-full p-2.5 bg-slate-700 border border-slate-600 rounded-md focus:ring-sky-500 focus:border-sky-500"
                                >
                                    <option value="es">Español</option>
                                    <option value="en">Inglés</option>
                                    <option value="pt">Portugués</option>
                                    <option value="fr">Francés</option>
                                </select>
                            </div>
                            <button
                                onClick={submitProfile}
                                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold py-2.5 px-4 rounded-md transition-colors duration-150 flex items-center justify-center"
                            >
                                <CheckCircleIcon className="h-5 w-5 mr-2" /> Guardar Perfil
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="w-full max-w-4xl space-y-8">
                <section className="bg-slate-800 p-6 rounded-xl shadow-2xl">
                     <h2 className="text-2xl font-semibold text-sky-400 mb-4">1. Sube tu Material de Estudio</h2>
                    <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleImageUpload} className="hidden" ref={fileInputRef}/>
                    <button onClick={triggerFileInput}
                        className="w-full flex items-center justify-center px-6 py-3 border-2 border-dashed border-sky-600 rounded-lg text-sky-400 hover:bg-sky-700 hover:text-white transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-50"
                    >
                        <ArrowUpTrayIcon className="h-6 w-6 mr-2" />
                        <span>Seleccionar Imagen (PNG, JPG, WEBP)</span>
                    </button>
                    {imagePreview && (
                        <div className="mt-6 text-center">
                            <h3 className="text-lg font-medium text-sky-300 mb-2">Vista Previa:</h3>
                            <img src={imagePreview} alt="Vista previa del material" className="max-w-full md:max-w-md mx-auto rounded-lg shadow-md border-2 border-sky-700" />
                            <button onClick={extractTextFromImage} disabled={isLoadingText || !image}
                                className="mt-4 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 px-6 rounded-md transition-colors duration-150 flex items-center justify-center mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoadingText ? ( <> <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div> Extrayendo Texto... </> ) 
                                : ( <> <DocumentTextIcon className="h-5 w-5 mr-2" /> Extraer Texto de Imagen </> )}
                            </button>
                        </div>
                    )}
                </section>

                {extractedText && !isLoadingText && (
                    <section className="bg-slate-800 p-6 rounded-xl shadow-2xl">
                        <h2 className="text-2xl font-semibold text-sky-400 mb-3">2. Texto Extraído</h2>
                        <div className={`bg-slate-700 p-4 rounded-md max-h-60 overflow-y-auto border ${extractedText.toLowerCase().startsWith("error") || extractedText.toLowerCase().startsWith("no se pudo") ? 'border-red-500' : 'border-slate-600'}`}>
                            <p className={`whitespace-pre-wrap text-sm ${extractedText.toLowerCase().startsWith("error") || extractedText.toLowerCase().startsWith("no se pudo") ? 'text-red-300' : ''}`}>{extractedText}</p>
                        </div>
                    </section>
                )}
                
                {/* Sección de Selección de Herramienta de Estudio Principal */}
                {extractedText && !isLoadingText && !extractedText.toLowerCase().startsWith("error") && !extractedText.toLowerCase().startsWith("no se pudo") && (
                    <section className="bg-slate-800 p-6 rounded-xl shadow-2xl">
                        <h2 className="text-2xl font-semibold text-sky-400 mb-4">3. Elige tu Herramienta de Repaso Principal</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <button onClick={() => generateStudyAid('summary')} disabled={isLoadingStudyAid || isLoadingMindMapImage || isLoadingExplanation || isLoadingExamples}
                                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-md transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            > <LightBulbIcon className="h-5 w-5 mr-2" /> Resumen </button>
                            <button onClick={() => generateStudyAid('quiz')} disabled={isLoadingStudyAid || isLoadingMindMapImage || isLoadingExplanation || isLoadingExamples}
                                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-md transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            > <PuzzlePieceIcon className="h-5 w-5 mr-2" /> Quiz </button>
                            <button onClick={() => generateStudyAid('faq')} disabled={isLoadingStudyAid || isLoadingMindMapImage || isLoadingExplanation || isLoadingExamples}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 rounded-md transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            > <ChatBubbleLeftRightIcon className="h-5 w-5 mr-2" /> FAQ Guía </button>
                            <button onClick={() => generateStudyAid('mindmap_description')} disabled={isLoadingStudyAid || isLoadingMindMapImage || isLoadingExplanation || isLoadingExamples}
                                className="bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 px-4 rounded-md transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            > <PhotoIcon className="h-5 w-5 mr-2" /> Mapa Mental (Img) </button>
                        </div>
                    </section>
                )}

                {/* Nuevas Funcionalidades IA */}
                {extractedText && !isLoadingText && !extractedText.toLowerCase().startsWith("error") && !extractedText.toLowerCase().startsWith("no se pudo") && (
                    <section className="bg-slate-800 p-6 rounded-xl shadow-2xl">
                        <h2 className="text-2xl font-semibold text-sky-400 mb-4">✨ Herramientas IA Adicionales</h2>
                        <div className="space-y-4">
                            {/* Explicar Concepto Clave */}
                            <div>
                                <label htmlFor="conceptInput" className="block text-sm font-medium text-sky-300 mb-1">Explorar un concepto del texto:</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        id="conceptInput"
                                        value={conceptToExplain}
                                        onChange={(e) => setConceptToExplain(e.target.value)}
                                        placeholder="Escribe un concepto o término..."
                                        className="flex-grow p-2.5 bg-slate-700 border border-slate-600 rounded-md focus:ring-sky-500 focus:border-sky-500 text-sm"
                                    />
                                    <button
                                        onClick={explainKeyConcept}
                                        disabled={isLoadingExplanation || !conceptToExplain.trim()}
                                        className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-2.5 px-4 rounded-md transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                    >
                                        {isLoadingExplanation ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div> : <SparklesIcon className="h-5 w-5"/>}
                                        <span className="ml-2">Explicar</span>
                                    </button>
                                </div>
                            </div>
                             {/* Generar Ejemplos Prácticos */}
                            <button
                                onClick={generatePracticalExamples}
                                disabled={isLoadingExamples}
                                className="w-full bg-lime-600 hover:bg-lime-500 text-white font-semibold py-2.5 px-4 rounded-md transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                                {isLoadingExamples ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div> : <BeakerIcon className="h-5 w-5 mr-2"/>}
                                Generar Ejemplos Prácticos
                            </button>
                        </div>
                    </section>
                )}
                
                {/* Indicador de Carga General para Ayudas Principales (no para explicación/ejemplos individuales) */}
                {(isLoadingStudyAid || isLoadingMindMapImage) && !isLoadingExplanation && !isLoadingExamples && (
                    <div className="flex flex-col items-center justify-center p-10 bg-slate-800 rounded-xl shadow-2xl">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-sky-500"></div>
                        <p className="mt-4 text-xl text-sky-300">
                            {isLoadingMindMapImage ? "Generando imagen del mapa mental con IA..." : "Generando ayuda de estudio con IA..."}
                        </p>
                    </div>
                )}

                {/* Sección de Visualización de Resultados (Ayudas Principales Y Nuevas Funciones) */}
                 {((!isLoadingStudyAid && !isLoadingMindMapImage && generatedAid) || 
                   (!isLoadingExplanation && explanationResult) || 
                   (!isLoadingExamples && examplesResult)) && (
                    <section className="bg-slate-800 p-6 rounded-xl shadow-2xl">
                        <div ref={exportContentRef}> {/* Contenedor para exportar a PDF */}
                            {/* Mostrar Explicación de Concepto */}
                            {activeFeature === 'explanation' && explanationResult && (
                                 <>
                                    <h2 className="text-2xl font-semibold text-sky-400 mb-4">✨ Explicación del Concepto: <span className="text-cyan-400">{conceptToExplain}</span></h2>
                                    <div className="bg-slate-700 p-4 rounded-md border border-slate-600 whitespace-pre-wrap text-sm">
                                        {explanationResult}
                                    </div>
                                </>
                            )}
                            {isLoadingExplanation && activeFeature === 'explanation' && (
                                <div className="flex flex-col items-center justify-center p-6">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400"></div>
                                    <p className="mt-3 text-lg text-cyan-300">Explicando concepto...</p>
                                </div>
                            )}

                            {/* Mostrar Ejemplos Prácticos */}
                            {activeFeature === 'examples' && examplesResult && (
                                 <>
                                    <h2 className="text-2xl font-semibold text-sky-400 mb-4">✨ Ejemplos Prácticos</h2>
                                    <div className="bg-slate-700 p-4 rounded-md border border-slate-600 whitespace-pre-wrap text-sm">
                                        {examplesResult}
                                    </div>
                                </>
                            )}
                             {isLoadingExamples && activeFeature === 'examples' && (
                                <div className="flex flex-col items-center justify-center p-6">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lime-400"></div>
                                    <p className="mt-3 text-lg text-lime-300">Generando ejemplos...</p>
                                </div>
                            )}


                            {/* Mostrar Ayudas de Estudio Principales (si no hay explicación/ejemplos activos) */}
                            {generatedAid && !activeFeature && (
                                <>
                                    <h2 className="text-2xl font-semibold text-sky-400 mb-4">
                                        {studyAidType === 'summary' && 'Resumen Generado por IA'}
                                        {studyAidType === 'quiz' && 'Quiz Interactivo (IA)'}
                                        {studyAidType === 'faq' && 'FAQ Guía de Estudio (IA)'}
                                        {studyAidType === 'mindmap_description' && 'Mapa Mental (Imagen IA)'}
                                    </h2>
                                    {studyAidType === 'summary' && typeof generatedAid === 'string' && ( <div className="bg-slate-700 p-4 rounded-md border border-slate-600"> <p className="whitespace-pre-wrap">{generatedAid}</p> </div> )}
                                    {studyAidType === 'quiz' && Array.isArray(generatedAid) && ( 
                                        <div className="space-y-6">
                                            {generatedAid.map((item, index) => (
                                                <div key={index} className="bg-slate-700 p-4 rounded-lg border border-slate-600 shadow">
                                                    <p className="font-semibold text-sky-300 mb-2">{index + 1}. {item.question}</p>
                                                    <div className="space-y-2">
                                                        {item.options && item.options.map((option, optIndex) => (
                                                            <button
                                                                key={optIndex}
                                                                onClick={() => handleQuizAnswer(index, optIndex)}
                                                                disabled={quizFeedback[index] !== undefined}
                                                                className={`w-full text-left p-2.5 rounded-md transition-colors duration-150 
                                                                    ${quizFeedback[index]?.userAnswer === optIndex ? 
                                                                        (quizFeedback[index]?.correct ? 'bg-green-500 hover:bg-green-400' : 'bg-red-500 hover:bg-red-400') : 
                                                                        'bg-slate-600 hover:bg-slate-500'} 
                                                                    disabled:opacity-70 disabled:cursor-not-allowed`}
                                                            >
                                                                {String.fromCharCode(65 + optIndex)}. {option}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {quizFeedback[index] !== undefined && (
                                                        <div className={`mt-3 p-2 rounded-md text-sm ${quizFeedback[index].correct ? 'bg-green-700 text-green-100' : 'bg-red-700 text-red-100'}`}>
                                                            {quizFeedback[index].correct ? 
                                                                `¡Correcto! ${item.explanation || ''}` : 
                                                                `Incorrecto. La respuesta correcta era la opción ${String.fromCharCode(65 + item.correctAnswerIndex)}. ${item.explanation || ''}`
                                                            }
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {quizFeedback.length > 0 && quizFeedback.length === generatedAid.length && (
                                                 <div className="mt-6 p-4 bg-sky-700 rounded-lg text-center">
                                                    <h3 className="text-xl font-semibold">Quiz Completado</h3>
                                                    <p className="text-2xl mt-1">Puntuación: {currentScore} / {generatedAid.length}</p>
                                                    <button
                                                        onClick={() => setShowShareModal(true)}
                                                        className="mt-4 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold py-2 px-4 rounded-md transition-colors duration-150 flex items-center justify-center mx-auto"
                                                    >
                                                        <ShareIcon className="h-5 w-5 mr-2" /> Compartir Resultado (Simulado)
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                     )}
                                    {studyAidType === 'faq' && <FaqDisplay data={generatedAid} />}
                                    {studyAidType === 'mindmap_description' && <MindMapImageDisplay imageUrl={generatedAid} />}
                                    {typeof generatedAid === 'string' && (generatedAid.toLowerCase().includes("error") || generatedAid.toLowerCase().includes("no se pudo")) && studyAidType !== 'summary' && studyAidType !== 'mindmap_description' && ( <div className="bg-red-800 p-4 rounded-md border border-red-600 text-red-100"> <p className="font-semibold mb-1">Respuesta de IA:</p> <p className="whitespace-pre-wrap">{generatedAid}</p> </div> )}
                                </>
                            )}
                        </div> {/* Fin de exportContentRef */}

                        {/* Botón de Exportar a PDF - se muestra si hay algún contenido visible para exportar */}
                        {(generatedAid && !activeFeature && !isLoadingStudyAid && !isLoadingMindMapImage) || (activeFeature === 'explanation' && explanationResult && !isLoadingExplanation) || (activeFeature === 'examples' && examplesResult && !isLoadingExamples) ? (
                            <div className="mt-6 flex justify-center">
                                <button
                                    onClick={handleExportToPDF}
                                    className="bg-red-600 hover:bg-red-500 text-white font-semibold py-2.5 px-6 rounded-md transition-colors duration-150 flex items-center justify-center text-sm"
                                >
                                    <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                                    Exportar a PDF
                                </button>
                            </div>
                        ) : null}
                    </section>
                )}
            </main>

            {showShareModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-800 p-6 rounded-lg shadow-2xl w-full max-w-sm text-center">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold text-sky-400">Compartir (Simulación)</h2>
                             <button onClick={() => setShowShareModal(false)} className="p-1 rounded-md hover:bg-slate-700">
                                <XMarkIcon className="h-6 w-6" />
                            </button>
                        </div>
                        <p className="text-slate-300 mb-4">¡Comparte tus logros o materiales de estudio!</p>
                        <div className="space-y-3">
                            <button className="w-full bg-blue-500 hover:bg-blue-400 p-2 rounded">Email</button>
                            <button className="w-full bg-green-500 hover:bg-green-400 p-2 rounded">WhatsApp</button>
                            <button className="w-full bg-pink-500 hover:bg-pink-400 p-2 rounded">Redes Sociales</button>
                        </div>
                         <p className="text-xs text-slate-500 mt-4">Esta es una función simulada.</p>
                    </div>
                </div>
            )}

            <footer className="w-full max-w-4xl mt-12 text-center text-sm text-slate-500">
                <p>&copy; {new Date().getFullYear()} StudySpark AI. Creado con fines demostrativos.</p>
                <p>ID de Aplicación: {appId}</p>
                 <p className="text-xs mt-1">Recuerda reemplazar las claves API de Firebase y Google AI si es necesario.</p>
                 <p className="text-xs mt-1">Para exportar a PDF, asegúrate de tener las librerías jsPDF y html2canvas cargadas en tu proyecto.</p>
            </footer>
        </div>
    );
};

export default App;
