// import { type FwFace } from "@ndn/fw";
// import { WsTransport } from "@ndn/ws-transport";
import { Encoder, Decoder } from "@ndn/tlv"
import { Endpoint, type Producer } from "@ndn/endpoint";
import { SvSync, type SyncNode, type SyncUpdate } from "@ndn/sync"
// import { enableNfdPrefixReg } from "@ndn/nfdmgmt"
import { Name, Data, digestSigning, type Interest } from "@ndn/packet";
import { SequenceNum, Version } from "@ndn/naming-convention2";
import { fromUtf8, toUtf8 } from "@ndn/util";
import { PeerJsListener } from "./peerjs-transport";
import { generateSigningKey, Ed25519, Certificate, NamedSigner, ValidityPeriod, createVerifier } from "@ndn/keychain";
import * as qrcode from "qrcode";
import QrScanner from "qr-scanner";

const certQrCodeCanvasId = "cert-qrcode";

export var listener: PeerJsListener;
export var endpoint: Endpoint;
export var syncInst: SvSync;
export const nodeId = '/node-' + Array.from(crypto.getRandomValues(new Uint8Array(4)))
  .map(v => v.toString(16).padStart(2, '0'))
  .join('');
var syncNode: SyncNode;
export var pktStorage: { [name: string]: Data } = {};
export var certStorage: { [name: string]: Certificate } = {};
export const syncPrefix = '/example/testJsonPatch'
export var applyPatch: (patch: string) => void;
export var signer: NamedSigner<true>;
export var certificate: Certificate;

export async function connect() {
  const opts: PeerJsListener.Options = {
    host: "localhost",
    port: 8000,
    path: "/aincraft",
    key: "peerjs",
  }
  // Create a PeerJs listener.
  //
  // A route for "/" prefix is added automatically.
  // You may customize the route prefixes via addRoutes property in the first argument.
  listener = await PeerJsListener.listen(opts);
  await listener.connectToKnownPeers();

  // Construct an Endpoint on the default Forwarder instance.
  endpoint = new Endpoint();

  endpoint.produce(nodeId + syncPrefix, dataPktServer, { describe: 'dataHandler' });
  // uplink.addAnnouncement(nodeId + syncPrefix);

  return endpoint;
}

export function shutdown() {
  listener.closeAll();
}

async function dataPktServer(interest: Interest, producer: Producer) {
  const name = interest.name.toString();
  return pktStorage[name];
}

async function handleSyncUpdate(update: SyncUpdate<Name>) {
  console.log(update.id, update.loSeqNum, update.hiSeqNum);
  let loSeqNum = update.loSeqNum;
  if (loSeqNum == 1) {
    loSeqNum = 0;  // Fix the problem of not starting from 0.
  }
  let prefix = update.id.append(...Name.from(syncPrefix).comps);
  for (let i = loSeqNum; i <= update.hiSeqNum; i++) {
    try {
      const data = await endpoint.consume(prefix.append(SequenceNum.create(i)));

      // Verification
      const keyName = data.sigInfo.keyLocator?.name;
      if (!keyName) {
        throw new Error(`Data not signed: ${data.name.toString()}`);
      }
      const cert = certStorage?.[keyName.toString()];
      if (!cert) {
        throw new Error(`No certificate: ${data.name.toString()} signed by ${keyName.toString()}`);
      }
      const verifier = await createVerifier(cert, { algoList: [Ed25519] });
      try {
        await verifier.verify(data);
      } catch (error) {
        throw new Error(`Unable to verify ${data.name.toString()} signed by ${keyName.toString()} due to: ${error}`);
      }

      // Apply patch
      const patch = fromUtf8(data.content);
      console.log(`Update received: ${prefix}/seq=${i} ${patch}`);
      applyPatch(patch);

      // Cache data packet for other peers (gossip)
      const name = data.name.toString();
      pktStorage[name] = data;
    } catch (err) {
      // Ignore errors
      console.error(`Sync error ignored: ${err}`);
    }
  }
}

export function createSync() {
  syncInst = new SvSync({
    endpoint: endpoint,
    syncPrefix: Name.from(syncPrefix),
    signer: digestSigning,
  });
  syncInst.addEventListener("update", handleSyncUpdate);
  syncNode = syncInst.add(nodeId);
  // uplink.addAnnouncement(syncPrefix);
  produce('{"op":"nop","@version":0,"@name":"/root"}', true);  // Skip sequence number 0
}

export async function produce(content: string, skipZeroFlag = false) {
  let seqNum = syncNode.seqNum + 1;
  if (skipZeroFlag) {
    seqNum = 0;
  }
  const name = Name.from(nodeId + syncPrefix).append(SequenceNum.create(seqNum));
  let data = new Data(
    name,
    Data.FreshnessPeriod(60000),
    toUtf8(content),
  );
  await signer.sign(data);
  pktStorage[name.toString()] = data;
  if (!skipZeroFlag) {
    syncNode.seqNum = seqNum;
  }
}

export function setApplyPatch(callback: (patch: string) => void) {
  applyPatch = callback;
}

function base64ToBytes(base64: string) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes: Uint8Array) {
  const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join("");
  return btoa(binString);
}

export async function selfSignCert() {
  const [prvKey, pubKey] = await generateSigningKey(`${nodeId}/KEY/1`, Ed25519);
  signer = prvKey;
  certificate = await Certificate.build({
    name: (new Name(`${nodeId}/KEY/1/self`)).append(Version.create(Date.now())),
    validity: new ValidityPeriod(Date.now(), Date.now() + 360000000),
    signer: signer,
    publicKeySpki: pubKey.spki,
  });

  let encoder = new Encoder();
  certificate.data.encodeTo(encoder);
  const wire = encoder.output;
  qrcode.toCanvas(
    document.getElementById(certQrCodeCanvasId),
    bytesToBase64(wire),
    function (error) {
      if (error) {
        console.error(`Unable to generate QRCode: ${error}`)
      }
    })
}

export async function scanQrCode(file: File) {
  try {
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    console.log(`Loaded QRData: ${result.data}`);
    const wire = base64ToBytes(result.data);
    let decoder = new Decoder(wire);
    const data = Data.decodeFrom(decoder);
    const cert = Certificate.fromData(data);
    const keyName = cert.name.getPrefix(cert.name.length - 2);
    certStorage[keyName.toString()] = cert;
    console.log(`Imported certificate of key: ${keyName}`);
  } catch (error) {
    console.error(`Unable to parse QRCode due to error: ${error}`)
  }
}
