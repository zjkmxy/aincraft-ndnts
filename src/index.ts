import { DetailEvent } from "aframe";
import { Endpoint, Producer } from "@ndn/endpoint";
import { Data, Interest, Name } from "@ndn/packet";
import { PeerJsListener } from "./peerjs-transport";
import { CertStorage } from "./cert-storage"
import * as utils from "./utils"
import { NdnAdapter } from "./automerge-ndn-adapter"
import { CrdtScene } from "./aframe-automerge"
import { AutomergeUrl } from "@automerge/automerge-repo";
import { fromUtf8, toUtf8 } from "@ndn/util";

// Due to mysterious reason:
// Due to mysterious reason, you cannot cast the element to HTMLInputElement, though it is an HTMLInputElement.
// Will be undefined if you try to do so.
export var qrInputEl: any = document.getElementById("qr-input");
export const certQrCodeCanvasEl: HTMLElement = document.getElementById("cert-qrcode");
export const rootSceneEl: HTMLElement = document.getElementById("root");
export const nodeId = '/node-' + Array.from(crypto.getRandomValues(new Uint8Array(4)))
  .map(v => v.toString(16).padStart(2, '0'))
  .join('');
export const syncPrefix = '/example/testAutomerge';

export var docId: AutomergeUrl;
export var listener: PeerJsListener;
export var endpoint: Endpoint;
export var certStorage: CertStorage;
export var adapter: NdnAdapter;
export var scene: CrdtScene;

export async function initialize() {
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

  // Certificates
  certStorage = new CertStorage(new Name(nodeId));
  await certStorage.readyEvent;
  const selfCert = certStorage.exportSelfCert();
  utils.drawQrCode(selfCert, certQrCodeCanvasEl);

  // Paste certificates
  qrInputEl.addEventListener("change", () => {
    for (const file of qrInputEl.files) {
      scanQrCode(file);
    }
  });
  window.addEventListener('paste', e => {
    qrInputEl.files = e.clipboardData.files;
    for (const file of qrInputEl.files) {
      scanQrCode(file);
    }
  });

  // Fetch docId and see if we are the first one
  if (listener.faces.length > 0) {
    try {
      var data = await endpoint.consume(syncPrefix + '/docId', {});
      docId = fromUtf8(data.content) as AutomergeUrl;
    } catch (err) {
      console.error(`Unable to fetch document ID: ${err}. New document will be created.`);
      docId = undefined;
    }
  } else {
    docId = undefined;
  }

  // Scene using CRDT and Sync
  adapter = new NdnAdapter(endpoint, new Name(syncPrefix), certStorage.signer, certStorage);
  scene = new CrdtScene(adapter, docId, rootSceneEl);
  await scene.readyEvent;
  if (!docId) {
    docId = scene.docId;
    console.log(`Created document: ${docId}`);
  } else {
    console.log(`Loaded document: ${docId}`);
  }

  // Help others know docId
  endpoint.produce(syncPrefix + '/docId', docIdServer, { describe: 'dataHandler' });
}

async function docIdServer(interest: Interest, producer: Producer) {
  const name = interest.name.toString();
  const content = toUtf8(docId);
  console.log(`Responded with docId = ${content}`);
  const data = new Data(
    name,
    Data.FreshnessPeriod(60000),
    content,
  );
  return data;
}

export function shutdown() {
  listener.closeAll();
}

export async function scanQrCode(file: File) {
  const wire = await utils.scanQrCode(file);
  if (wire) {
    certStorage.importCert(wire);
  }
}

AFRAME.registerComponent('intersection-spawn', {
  schema: {
    default: '',
    parse: AFRAME.utils.styleParser.parse
  },

  init: function () {
    const data = this.data;
    const el = this.el;

    el.addEventListener(data.event, (evt: DetailEvent<any>) => {
      // Snap intersection point to grid and offset from center.
      const pos = (AFRAME.utils as any).clone(evt.detail.intersection.point)
      data.offset = AFRAME.utils.coordinates.parse(data.offset)
      data.snap = AFRAME.utils.coordinates.parse(data.snap)
      pos.x = Math.floor(pos.x / data.snap.x) * data.snap.x + data.offset.x;
      pos.y = Math.floor(pos.y / data.snap.y) * data.snap.y + data.offset.y;
      pos.z = Math.floor(pos.z / data.snap.z) * data.snap.z + data.offset.z;

      // Generate random NDN name
      const boxId = `box-${Date.now()}`;

      // Create element.
      let spawnEl: { [key: string]: any } = {
        '@type': 'a-entity',
        '@id': boxId,
        '@children': {},
        'position': pos,
        'material': {
          color: utils.getRandomColor(),
        },
      };

      // Set components and properties.
      Object.keys(data).forEach(name => {
        if (name === 'event' || name === 'snap' || name === 'offset') {
          return;
        }
        spawnEl[name] = data[name];
      });

      // Pass to CRDT
      scene.changeDoc(doc => {
        doc['@children'][boxId] = spawnEl;
      })
    });
  }
});

// (async () => {
//   await aincraft_ts.selfSignCert();
//   await aincraft_ts.connect();
//   aincraft_ts.setApplyPatch(patch => applyPatch(patch));
//   aincraft_ts.createSync();
// })();
initialize();
