import { type FwFace } from "@ndn/fw";
import { WsTransport } from "@ndn/ws-transport";
import { Endpoint, type Producer } from "@ndn/endpoint";
import { SvSync, type SyncNode, type SyncUpdate } from "@ndn/sync"
import { enableNfdPrefixReg } from "@ndn/nfdmgmt"
import { Name, Data, digestSigning, type Interest } from "@ndn/packet";
import { SequenceNum } from "@ndn/naming-convention2";
import { fromUtf8, toUtf8 } from "@ndn/util";
import { PeerJsListener } from "./peerjs-transport";

export var listener: PeerJsListener;
export var endpoint: Endpoint;
export var syncInst: SvSync;
export const nodeId = '/node-' + Array.from(crypto.getRandomValues(new Uint8Array(4)))
  .map(v => v.toString(16).padStart(2, '0'))
  .join('');
var syncNode: SyncNode;
export var pktStorage: { [name: string]: Data } = {};
export const syncPrefix = '/example/testJsonPatch'
export var applyPatch: (patch: string) => void;

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
  // uplink.addAnnouncement(syncPrefix);
  produce('{"op":"nop","@version":0,"@name":"/root"}', true);  // Skip sequence number 0
}

export function produce(content: string, skipZeroFlag = false) {
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

export function setApplyPatch(callback: (patch: string) => void) {
  applyPatch = callback;
}
