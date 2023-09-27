import * as qrcode from "qrcode";
import QrScanner from "qr-scanner";

export function base64ToBytes(base64: string) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

export function bytesToBase64(bytes: Uint8Array) {
  const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join("");
  return btoa(binString);
}

export function drawQrCode(wire: Uint8Array, canvasElement: HTMLElement) {
  return new Promise<void>((resolve, reject) => {
    qrcode.toCanvas(
      canvasElement,
      bytesToBase64(wire),
      function (error) {
        if (error) {
          console.error(`Unable to generate QRCode: ${error}`);
          reject(error);
        } else {
          resolve();
        }
      });
  });
}

export async function scanQrCode(file: File) {
  try {
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    const wire = base64ToBytes(result.data);
    return wire;
  } catch (error) {
    console.error(`Unable to parse QRCode due to error: ${error}`);
    return undefined;
  }
}

export function getRandomColor() {
  const letters = '0123456789ABCDEF';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}
