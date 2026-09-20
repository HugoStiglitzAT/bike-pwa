document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById('btnConnect');
    if (btn) {
        btn.addEventListener('click', connectBLE);
    } else {
        console.error("Button 'btnConnect' wurde im DOM nicht gefunden!");
    }
});

async function connectBLE() {
    console.log("Koppel-Button wurde geklickt!");
    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'LilyGO-BikeComp' }],
            optionalServices: [SERVICE_UUID]
        });

        bleDevice.addEventListener('gattserverdisconnected', () => {
            document.getElementById('bleStatus').textContent = "GETRENNT";
            document.getElementById('bleStatus').className = "status";
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        
        telemetryChar = await service.getCharacteristic(TELEMETRY_CHAR_UUID);
        gpxChar = await service.getCharacteristic(GPX_CHAR_UUID);

        document.getElementById('bleStatus').textContent = "VERBUNDEN";
        document.getElementById('bleStatus').className = "status connected";

        startGPSTracking();
        setInterval(sendTelemetry, 1000);

    } catch (error) {
        console.error("Bluetooth-Fehler:", error);
        alert("Verbindung fehlgeschlagen: " + error.message);
    }
}
