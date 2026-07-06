/**
 * GestureVoice - AI Gesture to Speech Converter
 * Complete browser-only implementation using MediaPipe Hands + rule-based detection + Web Speech API
 * 
 * Features:
 * - Real-time hand tracking (MediaPipe)
 * - 6 gesture recognition (rule-based on landmarks)
 * - Text-to-speech with cooldown
 * - Beautiful responsive UI
 * - No backend, no external paid services
 */

// =============================================
// GLOBAL STATE
// =============================================
let hands = null;
let camera = null;
let isCameraRunning = false;
let lastSpokenTime = 0;
let lastGestureWord = "";
let currentRecognizedText = "—";
const COOLDOWN_MS = 2000; // 2 seconds cooldown to prevent repetitive speaking

// DOM Elements (cached for performance)
let webcamVideo, canvasElement, canvasCtx;
let startBtn, stopBtn, loadingOverlay, cameraPlaceholder, cameraStatus;
let handStatusText, gestureEmoji, gestureName, gestureWord, confidenceValue, confidenceBar, detectionIndicator;
let outputText, speakAgainBtn;

// =============================================
// INITIALIZATION
// =============================================
function initDOMElements() {
    webcamVideo = document.getElementById('webcam');
    canvasElement = document.getElementById('canvas');
    canvasCtx = canvasElement.getContext('2d', { alpha: true });

    startBtn = document.getElementById('start-btn');
    stopBtn = document.getElementById('stop-btn');
    loadingOverlay = document.getElementById('loading-overlay');
    cameraPlaceholder = document.getElementById('camera-placeholder');
    cameraStatus = document.getElementById('camera-status');

    handStatusText = document.getElementById('hand-status-text');
    gestureEmoji = document.getElementById('gesture-emoji');
    gestureName = document.getElementById('gesture-name');
    gestureWord = document.getElementById('gesture-word');
    confidenceValue = document.getElementById('confidence-value');
    confidenceBar = document.getElementById('confidence-bar');
    detectionIndicator = document.getElementById('detection-indicator');

    outputText = document.getElementById('output-text');
    speakAgainBtn = document.getElementById('speak-again-btn');
}

// Initialize Tailwind config (for dynamic classes if needed)
function initTailwind() {
    // Already loaded via CDN in HTML. This is just in case we need runtime config.
    console.log('%c[GestureVoice] Tailwind CSS ready', 'color:#64748b');
}

// =============================================
// MEDIAPIPE SETUP
// =============================================
async function initMediaPipe() {
    return new Promise((resolve, reject) => {
        try {
            // Show loading state
            if (loadingOverlay) loadingOverlay.classList.remove('hidden');
            if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';

            hands = new Hands({
                locateFile: (file) => {
                    // Use official CDN for WASM + model files
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
                }
            });

            hands.setOptions({
                maxNumHands: 1,              // Single hand for simplicity & performance
                modelComplexity: 1,          // 0 = lite, 1 = full (good balance)
                minDetectionConfidence: 0.75,
                minTrackingConfidence: 0.75
            });

            hands.onResults(onMediaPipeResults);

            console.log('%c[GestureVoice] MediaPipe Hands initialized successfully', 'color:#22c55e');
            resolve(true);
        } catch (error) {
            console.error('[GestureVoice] MediaPipe init failed:', error);
            reject(error);
        }
    });
}

// =============================================
// CAMERA CONTROL
// =============================================
async function startCamera() {
    if (isCameraRunning) return;

    try {
        // Request camera permission explicitly first (better UX + error handling)
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });

        // Stop any previous stream
        if (webcamVideo.srcObject) {
            webcamVideo.srcObject.getTracks().forEach(track => track.stop());
        }

        webcamVideo.srcObject = stream;

        // Hide placeholder, show video
        if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';
        if (loadingOverlay) loadingOverlay.classList.add('hidden');

        // Initialize MediaPipe if not already done
        if (!hands) {
            await initMediaPipe();
        }

        // Create MediaPipe Camera helper (handles 30fps loop)
        camera = new Camera(webcamVideo, {
            onFrame: async () => {
                if (hands && isCameraRunning) {
                    await hands.send({ image: webcamVideo });
                }
            },
            width: 640,
            height: 480
        });

        await camera.start();

        // Update UI
        isCameraRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;

        cameraStatus.innerHTML = `
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
            <span class="text-emerald-400">LIVE • TRACKING</span>
        `;
        cameraStatus.classList.add('connected');
        cameraStatus.classList.remove('bg-red-500/10', 'text-red-400', 'border-red-500/20');
        cameraStatus.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/20');

        // Reset detection UI
        resetDetectionUI();

        console.log('%c[GestureVoice] Camera started successfully', 'color:#22c55e');

    } catch (error) {
        console.error('[GestureVoice] Camera error:', error);
        handleCameraError(error);
    }
}

function stopCamera() {
    if (!isCameraRunning) return;

    // Stop MediaPipe camera
    if (camera) {
        camera.stop();
        camera = null;
    }

    // Stop webcam stream
    if (webcamVideo && webcamVideo.srcObject) {
        webcamVideo.srcObject.getTracks().forEach(track => track.stop());
        webcamVideo.srcObject = null;
    }

    // Clear canvas
    if (canvasCtx) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }

    // Update state & UI
    isCameraRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;

    cameraStatus.innerHTML = `
        <div class="w-1.5 h-1.5 rounded-full bg-red-400"></div>
        <span>CAMERA OFF</span>
    `;
    cameraStatus.classList.remove('connected', 'bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/20');
    cameraStatus.classList.add('bg-red-500/10', 'text-red-400', 'border-red-500/20');

    // Show placeholder again
    if (cameraPlaceholder) cameraPlaceholder.style.display = 'flex';
    if (loadingOverlay) loadingOverlay.classList.add('hidden');

    // Reset detection display
    resetDetectionUI(true);

    console.log('%c[GestureVoice] Camera stopped', 'color:#f87171');
}

function handleCameraError(error) {
    let message = "Camera access failed.";
    
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        message = "Camera permission denied. Please allow access in your browser settings.";
    } else if (error.name === "NotFoundError") {
        message = "No camera found on this device.";
    } else if (error.name === "NotReadableError") {
        message = "Camera is already in use by another application.";
    }

    // Show error in placeholder
    if (cameraPlaceholder) {
        cameraPlaceholder.innerHTML = `
            <div class="text-center px-6">
                <div class="text-red-400 text-5xl mb-3">⚠️</div>
                <p class="font-semibold text-red-400">${message}</p>
                <button onclick="location.reload()" 
                        class="mt-4 px-5 py-2 text-xs rounded-xl bg-white/10 hover:bg-white/20 border border-white/20">
                    TRY AGAIN
                </button>
            </div>
        `;
        cameraPlaceholder.style.display = 'flex';
    }

    // Reset buttons
    startBtn.disabled = false;
    stopBtn.disabled = true;
    isCameraRunning = false;
}

// =============================================
// MEDIAPIPE RESULTS HANDLER
// =============================================
function onMediaPipeResults(results) {
    if (!canvasCtx || !canvasElement) return;

    const width = canvasElement.width;
    const height = canvasElement.height;

    // Clear previous frame
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, width, height);

    // Because we mirror the video with CSS scale-x-[-1], we must flip the canvas drawing too
    canvasCtx.scale(-1, 1);
    canvasCtx.translate(-width, 0);

    let detectedGesture = null;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const handedness = results.multiHandedness && results.multiHandedness.length > 0 
            ? results.multiHandedness[0].label 
            : 'Right';

        // Draw beautiful hand skeleton
        drawHandLandmarks(canvasCtx, landmarks, width, height);

        // Run our rule-based gesture recognition
        detectedGesture = detectGesture(landmarks, handedness);
    }

    canvasCtx.restore();

    // Update UI based on detection
    if (detectedGesture) {
        updateDetectionUI(detectedGesture);
        handleRecognizedGesture(detectedGesture);
    } else {
        // No hand or unrecognized gesture
        updateNoHandUI();
    }
}

// Draw hand connections + landmarks (beautiful teal/purple style)
function drawHandLandmarks(ctx, landmarks, width, height) {
    // Use MediaPipe's built-in drawing functions (available globally after CDN load)
    if (typeof drawConnectors !== 'undefined' && typeof drawLandmarks !== 'undefined' && typeof HAND_CONNECTIONS !== 'undefined') {
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
            color: '#67e8f9',
            lineWidth: 2.5
        });
        
        drawLandmarks(ctx, landmarks, {
            color: '#c026ff',
            lineWidth: 1.5,
            radius: 3.5
        });
        
        // Highlight fingertips
        const tipIndices = [4, 8, 12, 16, 20];
        tipIndices.forEach(idx => {
            const point = landmarks[idx];
            ctx.beginPath();
            ctx.arc(point.x * width, point.y * height, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#fef08c';
            ctx.fill();
        });
    } else {
        // Fallback simple drawing if drawing utils not loaded
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 2;
        ctx.fillStyle = '#c026ff';
        
        for (let i = 0; i < landmarks.length; i++) {
            const p = landmarks[i];
            ctx.beginPath();
            ctx.arc(p.x * width, p.y * height, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// =============================================
// GESTURE RECOGNITION (RULE-BASED)
// =============================================
function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Check if a non-thumb finger is extended (tip significantly above PIP)
function isFingerExtended(landmarks, tipIdx, pipIdx) {
    const tipY = landmarks[tipIdx].y;
    const pipY = landmarks[pipIdx].y;
    // Tip must be clearly above the PIP joint (y is inverted in screen coords)
    return tipY < pipY - 0.035;
}

// Check if thumb is extended (distance + position based)
function isThumbExtended(landmarks, handedness) {
    const tip = landmarks[4];
    const ip = landmarks[3];
    const mcp = landmarks[2];
    const wrist = landmarks[0];

    const distTipToWrist = getDistance(tip, wrist);
    const distMcpToWrist = getDistance(mcp, wrist);

    // Thumb is extended if tip is significantly farther from wrist than MCP
    const extendedByDistance = distTipToWrist > distMcpToWrist * 1.25;

    // Additional check: thumb should not be curled inward too much
    const curlCheck = getDistance(tip, ip) > 0.04;

    return extendedByDistance && curlCheck;
}

function detectGesture(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return null;

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    // Finger extension states
    const thumbExt = isThumbExtended(landmarks, handedness);
    const indexExt = isFingerExtended(landmarks, 8, 6);
    const middleExt = isFingerExtended(landmarks, 12, 10);
    const ringExt = isFingerExtended(landmarks, 16, 14);
    const pinkyExt = isFingerExtended(landmarks, 20, 18);

    const extendedCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length + (thumbExt ? 1 : 0);

    // Finger spread (index tip to pinky tip) - used to distinguish Open Palm vs Raised Hand
    const spread = getDistance(indexTip, pinkyTip);

    // === OK SIGN (thumb + index close forming circle, other 3 fingers extended) ===
    const thumbIndexDist = getDistance(thumbTip, indexTip);
    if (thumbIndexDist < 0.075 && 
        !indexExt && 
        middleExt && ringExt && pinkyExt && 
        thumbExt) {
        return {
            name: "OK Sign",
            word: "Perfect",
            confidence: 91,
            emoji: "👌"
        };
    }

    // === VICTORY / PEACE SIGN ===
    if (indexExt && middleExt && !ringExt && !pinkyExt && !thumbExt) {
        return {
            name: "Victory Sign",
            word: "Yes",
            confidence: 94,
            emoji: "✌️"
        };
    }

    // === THUMBS UP (only thumb extended + pointing upward) ===
    const isThumbsUp = thumbExt &&
                       !indexExt && !middleExt && !ringExt && !pinkyExt &&
                       (thumbTip.y < wrist.y - 0.12); // Thumb clearly above wrist

    if (isThumbsUp) {
        return {
            name: "Thumbs Up",
            word: "Okay",
            confidence: 87,
            emoji: "👍"
        };
    }

    // === CLOSED FIST ===
    if (!thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt) {
        return {
            name: "Closed Fist",
            word: "No",
            confidence: 89,
            emoji: "✊"
        };
    }

    // === OPEN PALM vs RAISED HAND (all fingers extended) ===
    if (thumbExt && indexExt && middleExt && ringExt && pinkyExt && extendedCount >= 4) {
        if (spread > 0.23) {
            // Fingers spread wide → Open Palm
            return {
                name: "Open Palm",
                word: "Hi",
                confidence: 93,
                emoji: "👋"
            };
        } else {
            // Fingers together → Raised Hand (Stop)
            return {
                name: "Raised Hand",
                word: "Stop",
                confidence: 84,
                emoji: "✋"
            };
        }
    }

    // No clear matching gesture this frame
    return null;
}

// =============================================
// UI UPDATE FUNCTIONS
// =============================================
function updateDetectionUI(gesture) {
    if (!gesture) return;

    // Hand status
    handStatusText.textContent = "Hand Detected";
    handStatusText.className = "text-emerald-400 font-semibold";

    // Gesture info
    gestureEmoji.innerHTML = gesture.emoji;
    gestureEmoji.classList.add('gesture-pop');
    setTimeout(() => gestureEmoji.classList.remove('gesture-pop'), 450);

    gestureName.textContent = gesture.name;
    gestureWord.textContent = gesture.word.toUpperCase();
    gestureWord.style.color = '#4ade80';

    // Confidence
    confidenceValue.textContent = `${gesture.confidence}%`;
    confidenceBar.style.width = `${gesture.confidence}%`;

    // Animated detection dot
    detectionIndicator.classList.add('active', 'bg-emerald-400');
    detectionIndicator.style.boxShadow = '0 0 0 6px rgba(52, 211, 153, 0.25)';

    // Enable speak again button
    if (speakAgainBtn) speakAgainBtn.disabled = false;
}

function updateNoHandUI() {
    handStatusText.textContent = "No Hand Detected";
    handStatusText.className = "text-white/60";

    gestureEmoji.innerHTML = "—";
    gestureName.textContent = "None";
    gestureWord.textContent = "—";
    gestureWord.style.color = '';

    confidenceValue.textContent = "—";
    confidenceBar.style.width = "0%";

    detectionIndicator.classList.remove('active', 'bg-emerald-400');
    detectionIndicator.style.boxShadow = '';
}

function resetDetectionUI(fullReset = false) {
    updateNoHandUI();

    if (fullReset) {
        outputText.textContent = "—";
        currentRecognizedText = "—";
        lastGestureWord = "";
        if (speakAgainBtn) speakAgainBtn.disabled = true;
    }
}

// Handle newly recognized gesture (with cooldown + auto speak)
function handleRecognizedGesture(gesture) {
    const now = Date.now();
    const isNewGesture = gesture.word !== lastGestureWord;
    const cooldownPassed = (now - lastSpokenTime) > COOLDOWN_MS;

    // Update output text immediately
    outputText.textContent = gesture.word;
    currentRecognizedText = gesture.word;

    // Speak only if:
    // 1. It's a different gesture, OR
    // 2. Cooldown has passed for the same gesture
    if (isNewGesture || cooldownPassed) {
        speak(gesture.word);
        lastSpokenTime = now;
        lastGestureWord = gesture.word;
    }
}

// =============================================
// TEXT-TO-SPEECH (Web Speech API)
// =============================================
function speak(text) {
    if (!text || text === "—") return;

    // Cancel any ongoing speech
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;      // Slightly slower for clarity
        utterance.pitch = 1.05;     // Pleasant voice
        utterance.volume = 0.95;

        // Optional: choose a nice voice if available
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
            v.lang.startsWith('en') && (v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Daniel'))
        );
        if (preferredVoice) utterance.voice = preferredVoice;

        window.speechSynthesis.speak(utterance);
    } else {
        console.warn('[GestureVoice] SpeechSynthesis not supported in this browser');
    }
}

function speakAgain() {
    if (currentRecognizedText && currentRecognizedText !== "—") {
        speak(currentRecognizedText);
        
        // Visual feedback
        const originalText = outputText.textContent;
        outputText.style.transitionDuration = '50ms';
        outputText.style.opacity = '0.4';
        
        setTimeout(() => {
            outputText.style.opacity = '1';
            outputText.style.transitionDuration = '150ms';
        }, 120);
    }
}

function clearOutput() {
    outputText.textContent = "—";
    currentRecognizedText = "—";
    lastGestureWord = "";
    lastSpokenTime = 0;
    
    if (speakAgainBtn) speakAgainBtn.disabled = true;
    
    // Subtle animation
    outputText.style.transitionDuration = '80ms';
    outputText.style.transform = 'scale(0.96)';
    setTimeout(() => {
        outputText.style.transform = 'scale(1)';
        outputText.style.transitionDuration = '150ms';
    }, 80);
}

// =============================================
// KEYBOARD SHORTCUTS (nice to have)
// =============================================
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 's' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (!isCameraRunning) {
                startCamera();
            } else {
                stopCamera();
            }
        }
        
        if (e.key === ' ' && isCameraRunning) {
            e.preventDefault();
            if (currentRecognizedText && currentRecognizedText !== "—") {
                speakAgain();
            }
        }
        
        if (e.key.toLowerCase() === 'c' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            clearOutput();
        }
    });

    // Show hint in console
    console.log('%c[GestureVoice] Keyboard shortcuts: S = Start/Stop camera, SPACE = Speak again, C = Clear', 'color:#64748b');
}

// =============================================
// BOOTSTRAP / APP START
// =============================================
function bootstrap() {
    initDOMElements();
    initTailwind();
    setupKeyboardShortcuts();

    // Set initial UI state
    stopBtn.disabled = true;
    cameraPlaceholder.style.display = 'flex';
    loadingOverlay.classList.add('hidden');

    // Warm up speech synthesis (some browsers require user interaction first, but we try)
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices(); // trigger load
    }

    // Welcome log
    console.log('%c[GestureVoice] ✅ Ready! Click "Start Camera" to begin gesture recognition.', 'color:#a5b4fc; font-size: 9px');
    
    // Optional: Auto-start hint (commented to respect user control)
    // setTimeout(() => {
    //     if (!isCameraRunning) console.log('%c[Hint] You can also press "S" key to start camera', 'color:#64748b');
    // }, 8000);
}

// Start the application
bootstrap();