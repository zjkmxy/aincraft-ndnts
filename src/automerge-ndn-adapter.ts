import { Message, NetworkAdapter, PeerId, cbor, isValidMessage } from "@automerge/automerge-repo"
import { Endpoint, type Producer } from "@ndn/endpoint";
import { SvSync, type SyncNode, type SyncUpdate } from "@ndn/sync"
import { Name, Data, digestSigning, type Interest, type Verifier } from "@ndn/packet";
import { SequenceNum } from "@ndn/naming-convention2";
import { type NamedSigner } from "@ndn/keychain";
import { fromUtf8, toUtf8 } from "@ndn/util";

export class NdnAdapter extends NetworkAdapter {
  private readonly nodeId: Name;
  private readonly baseName: Name;
  private readonly syncInst: SvSync;
  private readonly syncNode: SyncNode;
  private pktStorage: { [name: string]: Data } = {};

  constructor(
    private readonly endpoint: Endpoint,
    private readonly syncPrefix: Name,
    private readonly signer: NamedSigner<true>,
    private readonly verifier: Verifier
  ) {
    super()
    this.nodeId = this.signer.name.getPrefix(this.signer.name.length - 2);
    this.baseName = this.nodeId.append(...syncPrefix.comps);

    // Data handler
    endpoint.produce(this.baseName,
      async (interest: Interest, _producer: Producer) => {
        const name = interest.name.toString();
        return this.pktStorage[name];
      },
      { describe: 'NdnAdapter.dataHandler' });

    // SVS instance
    this.syncInst = new SvSync({
      endpoint: endpoint,
      syncPrefix: Name.from(syncPrefix),
      signer: digestSigning,
    });
    this.syncInst.addEventListener("update", update => this.handleSyncUpdate(update));
    this.syncNode = this.syncInst.add(this.nodeId);

    // Emit ready
    setTimeout(() => {
      this.emit("ready", { network: this });
    }, 10);
  }

  connect(peerId: PeerId): void {
    this.peerId = peerId
    // Do nothing for now
    console.debug(`Connected as peer ${peerId}.`);
    this.produce(toUtf8(peerId));  // Dummy production to announce peerId and trigger the sync start
  }

  disconnect(): void {
    // Do nothing for now
    console.debug(`Disconnected.`);
  }

  private async produce(content: Uint8Array) {
    let seqNum = this.syncNode.seqNum + 1;
    const name = this.baseName.append(SequenceNum.create(seqNum));
    let data = new Data(
      name,
      Data.FreshnessPeriod(60000),
      content,
    );
    await this.signer.sign(data);
    this.pktStorage[name.toString()] = data;
    this.syncNode.seqNum = seqNum;
  }

  send(message: Message): void {
    const encoded = cbor.encode(message);
    const arrayBuf = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength
    );
    const uint8Buf = new Uint8Array(arrayBuf);

    this.produce(uint8Buf);  // No need to await
    console.debug(`Produced ${JSON.stringify(message)}`);
  }

  private async handleSyncUpdate(update: SyncUpdate<Name>) {
    let prefix = update.id.append(...this.syncPrefix.comps);
    for (let i = update.loSeqNum; i <= update.hiSeqNum; i++) {
      const data = await this.endpoint.consume(prefix.append(SequenceNum.create(i)));
      try {
        // TODO: fix this
        // Currently we have to disable verification because the sync starts receiving packets
        // before the user has a chance to import certificates, and those packets cannot be validated.
        // To fix this, either:
        // - Trigger a re-sync whenever the user inputs a certificate. This is not how Sync is designed.
        //   SVS's implementation design assumes the certificates of all peers are known at the time it starts.
        // - Add a start button
        // await this.verifier.verify(data);
      } catch (error) {
        console.error(`Unable to verify ${data.name.toString()} due to: ${error}`);
        continue;
      }

      if (i == 1) {
        // First is the peer-id announce message
        const peerId = fromUtf8(data.content);
        console.debug(`Peer candidate ${peerId}`)
        this.emit("peer-candidate", { peerId: peerId as PeerId });
        continue;
      }

      if(data.content.length == 0){
        continue;
      }

      // Apply patch
      const decoded = cbor.decode(data.content);
      if (!isValidMessage(decoded)) {
        console.error(`Invalid message received: ${data.name.toString()}`);
      } else {
        console.log(`Update received: ${data.name.toString()}`);
        this.emit("message", decoded);
      }
    }
  }
}
