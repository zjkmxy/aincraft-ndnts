import { WsTransport } from "@ndn/ws-transport";
import { Endpoint } from "@ndn/endpoint";
import { SvSync } from "@ndn/sync"
import { enableNfdPrefixReg } from "@ndn/nfdmgmt"
import { Name, Data, digestSigning } from "@ndn/packet";
import { SequenceNum } from "@ndn/naming-convention2";
import { fromUtf8, toUtf8 } from "@ndn/util";

export var uplink;
export var endpoint;
export var syncInst;
export const nodeId = '/node-' + Array.from(crypto.getRandomValues(new Uint8Array(4)))
  .map(v => v.toString(16).padStart(2, '0'))
  .join('');
var syncNode;
export var pktStorage = {};
export const syncPrefix = '/example/testJsonPatch'
export var applyPatch;

export async function connect(uri) {
  if (uri === undefined || uri === null) {
    uri = "ws://localhost:9696/"
  }
  // Create a WebSocket face.
  // Unless otherwise specified, the face is added to the default Forwarder instance.
  // You may set an alternate Forwarder instance in the first argument.
  //
  // A route for "/" prefix is added automatically.
  // You may customize the route prefixes via addRoutes property in the first argument.
  uplink = await WsTransport.createFace({}, uri);
  uplink.attributes.local = true;  // Force ndnts to register the prefix correctly using localhost
  enableNfdPrefixReg(uplink);

  // Construct an Endpoint on the default Forwarder instance.
  endpoint = new Endpoint();

  endpoint.produce(nodeId + syncPrefix, dataPktServer, { describe: 'dataHandler' });
  uplink.addAnnouncement(nodeId + syncPrefix);

  return endpoint;
}

export function shutdown() {
  uplink.close();
}

async function dataPktServer(interest, producer) {
  const name = interest.name.toString();
  return pktStorage[name];
}

async function handleSyncUpdate(update) {
  console.log(update.id, update.loSeqNum, update.hiSeqNum);
  let loSeqNum = update.loSeqNum;
  if (loSeqNum == 1) {
    loSeqNum = 0;  // Fix the problem of not starting from 0.
  }
  let prefix = update.id.append(...Name.from(syncPrefix).comps);
  for (let i = loSeqNum; i <= update.hiSeqNum; i++) {
    try {
      const data = await endpoint.consume(prefix.append(SequenceNum.create(i)))
      const patch = fromUtf8(data.content);
      console.log(`Update received: ${prefix}/seq=${i} ${patch}`);
      applyPatch(patch);
    } catch (err) {
      // Ignore errors
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
  uplink.addAnnouncement(syncPrefix);
  produce('{"op":"nop","@version":0,"@name":"/root"}', true);  // Skip sequence number 0
}

export function produce(content, skipZeroFlag = false) {
  let seqNum = syncNode.seqNum + 1;
  if (skipZeroFlag) {
    seqNum = 0;
  }
  const name = Name.from(nodeId + syncPrefix).append(SequenceNum.create(seqNum));
  pktStorage[name.toString()] = new Data(
    name,
    Data.FreshnessPeriod(60000),
    toUtf8(content),
  );
  if (!skipZeroFlag) {
    syncNode.seqNum = seqNum;
  }
}

export function setApplyPatch(callback) {
  applyPatch = callback;
}
