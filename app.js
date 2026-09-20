// UUIDs
const SERVICE_UUID        = "42616b65-2020-2020-2020-202020202020";
const TELEMETRY_CHAR_UUID = "42616b65-0001-2020-2020-202020202020";
const GPX_CHAR_UUID       = "42616b65-0002-2020-2020-202020202020";

let bleDevice = null;
let telemetryChar = null;
let gpxChar = null;

// Wird direkt per onclick aufgerufen
async function connectBLE() {
    // 1. Visuelles Feedback durch Popup
    alert("Bluetooth-Suche gestartet...");

    if (!navigator.bluetooth) {
        alert("FEHLER: Dieser Browser unterstützt kein Web Bluetooth!");
        return;
    }

    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'LilyGO-BikeComp' }],
            optionalServices: [SERVICE_UUID]
        });

        alert("Gerät ausgewählt! Verbinde...");

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        
        telemetryChar = await service.getCharacteristic(TELEMETRY_CHAR_UUID);
        gpxChar = await service.getCharacteristic(GPX_CHAR_UUID);

        document.getElementById('bleStatus').textContent = "VERBUNDEN";
        document.getElementById('bleStatus').className = "status connected";

        alert("Verbindung erfolgreich hergestellt!");

    } catch (error) {
        alert("Bluetooth-Fehler: " + error.message);
        console.error(error);
    }
}
let currentSpeed = 0;
let currentDist = 0;
let lastLat = null;
let lastLon = null;

// Initialisierung bei Seitenaufruf
window.addEventListener('DOMContentLoaded', () => {
    logStatus("Seite bereit. Bitte auf Koppeln tippen.");

    // Bluetooth Button
    const btnConnect = document.getElementById('btnConnect');
    if (btnConnect) {
        btnConnect.addEventListener('click', connectBLE);
    } else {
        logStatus("FEHLER: Button 'btnConnect' nicht in HTML gefunden!");
    }

    // GPX Upload Listener
    const gpxInput = document.getElementById('gpxInput');
    if (gpxInput) {
        gpxInput.addEventListener('change', handleGPXUpload);
    }
});

function logStatus(msg) {
    console.log(msg);
    const statusEl = document.getElementById('gpxStatus');
    if (statusEl) {
        statusEl.textContent = msg;
    }
}



// --- GPS Tracking & Telemetrie ---
function startGPSTracking() {
    if (!navigator.geolocation) {
        logStatus("GPS wird nicht unterstützt.");
        return;
    }

    navigator.geolocation.watchPosition((pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const speedKmh = pos.coords.speed ? (pos.coords.speed * 3.6) : 0;
        currentSpeed = Math.max(0, speedKmh);

        if (lastLat !== null && lastLon !== null) {
            currentDist += calculateDistance(lastLat, lastLon, lat, lon);
        }
        lastLat = lat;
        lastLon = lon;

        document.getElementById('speedVal').textContent = currentSpeed.toFixed(1);
        document.getElementById('distVal').textContent = currentDist.toFixed(2);
    }, (err) => {
        console.warn("GPS Fehler:", err.message);
    }, {
        enableHighAccuracy: true,
        maximumAge: 1000
    });
}

async function sendTelemetry() {
    if (!telemetryChar || !bleDevice || !bleDevice.gatt.connected) return;

    try {
        const payload = `T:${currentSpeed.toFixed(1)},${currentDist.toFixed(2)}`;
        const encoder = new TextEncoder();
        await telemetryChar.writeValueWithoutResponse(encoder.encode(payload));
    } catch (err) {
        console.error("Telemetrie-Sende-Fehler:", err);
    }
}

// --- GPX Datei Verarbeiten & Senden ---
async function handleGPXUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!gpxChar || !bleDevice || !bleDevice.gatt.connected) {
        alert("Bitte zuerst das Display koppeln!");
        return;
    }

    logStatus("Lese GPX-Datei...");
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");

    let pts = xmlDoc.querySelectorAll("trkpt");
    if (pts.length === 0) pts = xmlDoc.querySelectorAll("wpt");
    if (pts.length === 0) pts = xmlDoc.querySelectorAll("rtept");

    if (pts.length === 0) {
        alert("Keine Punkte in der GPX gefunden!");
        return;
    }

    const maxPoints = 300;
    const step = Math.max(1, Math.floor(pts.length / maxPoints));
    let points = [];

    for (let i = 0; i < pts.length; i += step) {
        let lat = parseFloat(pts[i].getAttribute("lat")).toFixed(5);
        let lon = parseFloat(pts[i].getAttribute("lon")).toFixed(5);
        points.push(`${lat},${lon}`);
    }

    logStatus(`Sende ${points.length} Punkte...`);
    await streamGPXToESP32(points);
}

async function streamGPXToESP32(points) {
    const progressBar = document.getElementById('gpxProgress');
    if (progressBar) {
        progressBar.style.display = 'block';
        progressBar.value = 0;
    }

    const encoder = new TextEncoder();

    try {
        await gpxChar.writeValueWithResponse(encoder.encode("START"));
        await new Promise(r => setTimeout(r, 200));

        for (let i = 0; i < points.length; i++) {
            const chunk = `P:${points[i]}`;
            await gpxChar.writeValueWithResponse(encoder.encode(chunk));
            
            if (progressBar) {
                progressBar.value = Math.round(((i + 1) / points.length) * 100);
            }
            await new Promise(r => setTimeout(r, 20));
        }

        await gpxChar.writeValueWithResponse(encoder.encode("END"));
        logStatus(`Route erfolgreich geladen (${points.length} Punkte)!`);
    } catch (err) {
        logStatus("GPX-Sende-Fehler: " + err.message);
    } finally {
        if (progressBar) progressBar.style.display = 'none';
    }
}

// Haversine Formel für Distanz
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
