import { AFrame, Entity } from "aframe"
import { next as Automerge, PutPatch, DelPatch, SpliceTextPatch, InsertPatch } from "@automerge/automerge"
import { DocHandle, AutomergeUrl, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo'
import { NdnAdapter } from "./automerge-ndn-adapter"
import { DELETED, DocHandleChangePayload, READY, UNAVAILABLE } from "@automerge/automerge-repo/dist/DocHandle"

export class CrdtScene {
  repo: Repo;
  doc: DocHandle<any>;
  readonly readyEvent: Promise<void>;

  constructor(adapter: NdnAdapter, public docId: AutomergeUrl, private readonly rootEl: HTMLElement) {
    this.repo = new Repo({
      network: [adapter],
    });

    // Find or create
    // The API is confusing. It seems that they create a new empty doc when there is no one available.
    // if (docId) {
    //   this.doc = this.repo.find(docId);
    //   // TODO: This does not work. doc is always unavailable. Needs to figure out the reason.
    //   // Especially, no function of adapter is called: a REQUEST message is expected to be sent but it does not.
    // } else {
    //   this.doc = this.repo.create();
    //   this.docId = this.doc.url;
    //   this.doc.change((doc: any) => this.createNewRootDoc(doc));
    // }
    
    // Delay for the network to be ready
    this.readyEvent = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (this.docId) {
          this.doc = this.repo.find(this.docId);
        } else {
          this.doc = this.repo.create();
          this.docId = this.doc.url;
          this.doc.change((doc: any) => this.createNewRootDoc(doc));
        }
        resolve();
        this.doc.doc().then(doc => {
          return this.renderRootDoc();
        }).then(() => {
          // Setup hook for changes (either local or remote)
          this.doc.on('change', (payload) => this.onDocChange(payload));
        });
      },30);
    });
  }

  changeDoc(fn: (doc: any) => void) {
    this.doc.change(fn);
  }

  private createNewRootDoc(doc: any) {
    // TODO: Make this independent
    doc['@type'] = 'a-scene'
    doc['@id'] = 'root'
    doc['@children'] = {
      'assets': {
        '@type': 'a-assets',
        '@id': 'assets',
        '@children': {
          'groundTexture': {
            '@type': 'img',
            '@id': 'groundTexture',
            '@children': {},
            'src': '/static/floor.jpg',
            'alt': ''
          },
          'skyTexture': {
            '@type': 'img',
            '@id': 'skyTexture',
            '@children': {},
            'src': '/static/sky.jpg',
            'alt': ''
          },
          'voxel': {
            '@type': 'a-mixin',
            '@id': 'voxel',
            '@children': {},
            'geometry': 'primitive: box; height: 0.5; width: 0.5; depth: 0.5',
            'material': 'shader: standard'
          },
        }
      },
      'ground': {
        '@type': 'a-cylinder',
        '@id': 'ground',
        '@children': {},
        'src': '#groundTexture',
        'radius': 32,
        'height': 0.1,
      },
      'background': {
        '@type': 'a-background',
        '@id': 'background',
        '@children': {},
        'src': '#skyTexture',
        'radius': 30,
        'theta-length': 90,
      },
      'camera': {
        '@type': 'a-camera',
        '@id': 'camera',
        '@children': {
          'cursor': {
            '@type': 'a-cursor',
            '@id': 'cursor',
            '@children': {},
            'intersection-spawn': 'event: click; offset: 0.25 0.25 0.25; snap: 0.5 0.5 0.5; mixin: voxel',
          }
        },
      },
    }
  }

  private createElement(desc: { [field: string]: any }) {
    const retEl: Entity = document.createElement(desc['@type']);
    retEl.setAttribute('id', desc['@id']);

    Object.keys(desc).forEach(compName => {
      if (compName[0] != '@') {
        const val = desc[compName];
        retEl.setAttribute(compName, val);
      }
    })
    Object.values(desc['@children']).forEach(value => {
      const subEl = this.createElement(value);
      retEl.appendChild(subEl);
    })

    return retEl;
  }

  async renderRootDoc() {
    const doc = await this.doc.doc();

    // Only @children makes sense for /root object
    // this.rootEl.textContent = '';
    // this.rootEl.replaceChildren();
    Object.values(doc['@children']).forEach(value => {
      const subEl = this.createElement(value);
      this.rootEl.appendChild(subEl);
    })
  }

  private onDocChangeRebuild(payload: DocHandleChangePayload<any>) {
    // This function simply rebuild everything when a change is made
    this.renderRootDoc();
  }

  private onDocChange(payload: DocHandleChangePayload<any>) {
    for (const patch of payload.patches) {
      // See https://github.com/automerge/automerge/blob/main/rust/automerge-wasm/PATCH.md
      // console.debug(`Received patch: ${JSON.stringify(patch)}`);
      if (patch.action == 'put') {
        const putPatch = patch as PutPatch;
        // NOTE: As a quick and dirty hack, we know that the patch always call "put" with an empty value on a new child.
        // So we directly check if the path is ["@children","box-XXX"], and ignore other put patches
        if (patch.path.length == 2) {
          const boxId = patch.path[1];
          const subEl = this.createElement({'@type': 'a-entity', '@id': boxId, '@children': {}});
          this.rootEl.appendChild(subEl);
        } else if (patch.path.length == 4 && patch.path[2] == 'position') {
          const boxId = patch.path[1];
          const el = document.getElementById(boxId) as Entity;
          el.setAttribute('position', patch.path[3], patch.value);
        }
      } else if (patch.action == 'del') {
        const delPatch = patch as DelPatch;
        // TODO
        throw new Error("Method not implemented.");
      } else if (patch.action == 'splice') {
        const splicePatch = patch as SpliceTextPatch;
        // TODO
        if (patch.path.length >= 3) {
          const boxId = patch.path[1];
          const compName = patch.path[2];
          if(compName[0] == '@') {
            continue;
          }
          const el = document.getElementById(boxId) as Entity;
          if (patch.path.length == 4) {
            el.setAttribute(compName, patch.value);
          } else if (patch.path.length == 5) {
            el.setAttribute(compName, patch.path[3], patch.value);
          }
        }
      } else if (patch.action == 'insert') {
        const insertPatch = patch as InsertPatch;
        // TODO
        throw new Error("Method not implemented.");
      } else {
        console.error(`Unhandled patch: ${JSON.stringify(patch)}`);  // We did not handle all patches
      }
    }
  }
}