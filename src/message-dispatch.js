import "./utils/configs";
import { getAbsoluteHref } from "./utils/media-url-utils";
import { isValidSceneUrl } from "./utils/scene-url-utils";
import { spawnChatMessage } from "./react-components/chat-message";
import { SOUND_CHAT_MESSAGE, SOUND_QUACK, SOUND_SPECIAL_QUACK } from "./systems/sound-effects-system";
import ducky from "./assets/models/DuckyMesh.glb";
import { EventTarget } from "event-target-shim";
import { ExitReason } from "./react-components/room/ExitedRoomScreen";
import { LogMessageType } from "./react-components/room/ChatSidebar";
import { createNetworkedEntity } from "./utils/create-networked-entity";
import { add, testAsset, respawn } from "./utils/chat-commands";
import { isLockedDownDemoRoom } from "./utils/hub-utils";
import { loadState, clearState } from "./utils/entity-state-utils";
import { shouldUseNewLoader } from "./utils/bit-utils";

let uiRoot;
// Handles user-entered messages
export default class MessageDispatch extends EventTarget {
  constructor(scene, entryManager, hubChannel, remountUI, mediaSearchStore) {
    super();
    this.scene = scene;
    this.entryManager = entryManager;
    this.hubChannel = hubChannel;
    this.remountUI = remountUI;
    this.mediaSearchStore = mediaSearchStore;
    this.presenceLogEntries = [];
  }

  addToPresenceLog(entry) {
    entry.key = Date.now().toString();

    const lastEntry = this.presenceLogEntries.length > 0 && this.presenceLogEntries[this.presenceLogEntries.length - 1];
    if (lastEntry && entry.type === "permission" && lastEntry.type === "permission") {
      if (
        lastEntry.body.permission === entry.body.permission &&
        parseInt(entry.key) - parseInt(lastEntry.key) < 10000
      ) {
        this.presenceLogEntries.pop();
      }
    }

    this.presenceLogEntries.push(entry);
    this.remountUI({ presenceLogEntries: this.presenceLogEntries });
    if (entry.type === "chat" && this.scene.is("loaded")) {
      this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_CHAT_MESSAGE);
    }

    // Fade out and then remove
    setTimeout(() => {
      entry.expired = true;
      this.remountUI({ presenceLogEntries: this.presenceLogEntries });

      setTimeout(() => {
        this.presenceLogEntries.splice(this.presenceLogEntries.indexOf(entry), 1);
        this.remountUI({ presenceLogEntries: this.presenceLogEntries });
      }, 1000);
    }, 20000);
  }

  shuffleAndDivide(names) {
    /*
    // シャッフル
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }

    // 6等分に分割
    const chunkSize = Math.ceil(names.length / 6);
    const dividedList = [];
    for (let i = 0; i < names.length; i += chunkSize) {
      dividedList.push(names.slice(i, i + chunkSize));
    }

    // 結果を文字列としてまとめる
    let result = '';
    dividedList.forEach((group, index) => {
      group.forEach(name => {
        result += `${name}:${index + 1}、`; // グループ番号を1から始める
      });
    });

    // 最後の「、」を削除
    return result.slice(0, -1);*/

    // シャッフル
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }

    // 各名前にランダムに1から6のグループを割り当てる
    let result = '';
    names.forEach((name, index) => {
      const groupNumber = (index % 6) + 1; // 1から6のグループに分ける
      result += `${name}:${groupNumber}、`;
    });

    // 最後の「、」を削除
    return result.slice(0, -1);
  }

  assignAndBalanceNumbers(names, numbers) {
    // グループごとの配列を用意
    const existingGroups = [[], [], [], [], [], []];
    const unassigned = [];

    // 既に番号がある人を対応するグループに分類し、番号がない人は unassigned に追加
    names.forEach((name, index) => {
      const number = numbers[index];
      if (number) {
        existingGroups[number - 1].push(name);  // 1から6に対応するグループに分類
      } else {
        unassigned.push(name);  // 番号がない人をリストに追加
      }
    });

    // グループのサイズを均等にするために、番号が振られていない人にランダムで番号を割り当てる
    let minGroupSize = Math.floor((names.length) / 6); // 各グループの最小人数
    let extraPeople = names.length % 6; // 余りの人数

    unassigned.forEach(person => {
      // グループに追加（余りの人数がある場合、1人ずつ追加）
      let groupIndex = existingGroups.findIndex(group => group.length < minGroupSize + (extraPeople > 0 ? 1 : 0));
      existingGroups[groupIndex].push(person);
      if (existingGroups[groupIndex].length === minGroupSize + 1) extraPeople--; // 余りを調整
    });

    // 結果を「あああ：1、いいい：3、」のような形式に変換
    let result = '';
    existingGroups.forEach((group, index) => {
      group.forEach(name => {
        result += `${name}:${index + 1}、`;
      });
    });

    // 最後の「、」を取り除いて返す
    return result.slice(0, -1);
  }

  getNumberByName(str, name) {
    // 文字列を「、」で分割して、それぞれの名前と番号のペアを取得
    const pairs = str.split('、');
    
    // 名前と番号のペアをオブジェクトに格納
    const nameToNumber = {};
    pairs.forEach(pair => {
      const [n, number] = pair.split(':'); // 「：」で名前と番号を分割
      nameToNumber[n] = parseInt(number, 10);
    });
  
    // 指定した名前の番号を返す
    return String(nameToNumber[name]) || null; // 該当しない場合はnullを返す
  }

  receive(message) {
    if (isLockedDownDemoRoom()) return;

    const red = "\u001b[31m";
    const reset = "\u001b[0m";

    const isSlash = message.body !== undefined ? message.body.includes("///") : false;
    if (isSlash) {
      const chatBodyList = message.body.split("///");
      
      if (
        chatBodyList[0] === "systemMessage" &&
        chatBodyList[1] === "rollcall" &&
        chatBodyList[2] === "from" &&
        chatBodyList[3] !== window.APP.hubChannel.store.state.profile.displayName
      ) {
        const mail = window.APP.hubChannel.store.state.credentials.email;
        const admin = chatBodyList[3];
        const message =
            "systemMessage///rollcall///" + `${mail}` + "///to///" + `${admin}`;
          document.getElementById("avatar-rig").messageDispatch.dispatch(message);
        return;
      } else if(
        chatBodyList[0] === "systemMessage" &&
        chatBodyList[1] === "rollcall" &&
        chatBodyList[3] === "to" && 
        chatBodyList[4] === window.APP.hubChannel.store.state.profile.displayName
      ) {
        console.log(red + 'rollcall' + reset, chatBodyList[2]);
        return;
      } else if(
        chatBodyList[0] === "systemMessage" &&
        chatBodyList[1] === "grouping" &&
        chatBodyList[2] === "from" &&
        chatBodyList[3] === window.APP.hubChannel.store.state.profile.displayName,
        chatBodyList[4] === "without"
      ) {
        const adminList = chatBodyList[5] ? chatBodyList[5].split(",") : []; //withoutで規定されたグループ分けしないユーザーのリスト

        const presences = window.APP.hubChannel.presence.state; 
        const wholeList = Object.keys(presences).map(
          e => {
            if(adminList.includes(presences[e].metas[0].profile.displayName)) return undefined;
            return presences[e].metas[0].profile.displayName;
          }
        )
        .filter(Boolean); //ルームかロビーにいるユーザー全員のリスト
        const alreadyNum = Object.keys(presences).map(
          e => {
            if(adminList.includes(presences[e].metas[0].profile.displayName)) return undefined;
            return presences[e].metas[0].profile.team
          }
        )
        .filter(Boolean); //すでに割り振られているチーム番号のリスト
        
        const nameList = wholeList.filter(item => !adminList.includes(item)); //グループ分けされるユーザーのリスト

        let dividedList;
        if(chatBodyList[6] === "reset") {
          dividedList = this.shuffleAndDivide(nameList);
          console.log(red + "グループリセット&グループ分け実行" + reset);
          console.log(red + "実行細目" + reset);
          console.log("adminList=", adminList);
          console.log("wholeList=", wholeList);
          console.log("alreadyNum=", alreadyNum);
        } else {
          dividedList = this.assignAndBalanceNumbers(nameList, alreadyNum);
          console.log(red + "グループ分け実行" + reset);
          console.log(red + "実行細目" + reset);
          console.log("adminList=", adminList);
          console.log("wholeList=", wholeList);
          console.log("alreadyNum=", alreadyNum);
        }
        
        const message =
            "systemMessage///grouping///" + `${dividedList}` + "///without///" + chatBodyList[5];
        document.getElementById("avatar-rig").messageDispatch.dispatch(message);
      } else if(
        chatBodyList[0] === "systemMessage" &&
        chatBodyList[1] === "grouping" &&
        chatBodyList[3] === "without"
      ) {
        const adminList = chatBodyList[4] ? chatBodyList[4].split(",") : [];
        if(adminList.includes(window.APP.hubChannel.store.state.profile.displayName)) return;
        const result = this.getNumberByName(chatBodyList[2], window.APP.hubChannel.store.state.profile.displayName);
        window.APP.hubChannel.store.update({
          profile: {
            team: result
          }
        });
      } else if(
        chatBodyList[0] === "systemMessage" &&
        chatBodyList[1] === "grouping" &&
        chatBodyList[2] === window.APP.hubChannel.store.state.profile.displayName 
      ){
        window.APP.hubChannel.store.update({
          profile: {
            team: chatBodyList[3]
          }
        });
      } else if(
        chatBodyList[0] === "systemMessage" &&
        chatBodyList[1] === "unGrouping" &&
        chatBodyList[2] === window.APP.hubChannel.store.state.profile.displayName
      ){
        window.APP.hubChannel.store.update({
          profile: {
            team: ""
          }
        });
      } else if(
        chatBodyList[0] !== "systemMessage"
      ) {
        this.addToPresenceLog(message);
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      }
    } else {
      this.addToPresenceLog(message);
      this.dispatchEvent(new CustomEvent("message", { detail: message }));
    }
  }

  log = (messageType, props) => {
    this.receive({ type: "log", messageType, props });
  };

  dispatch = message => {
    if (message.startsWith("/")) {
      const commandParts = message.substring(1).split(/\s+/);
      this.dispatchCommand(commandParts[0], ...commandParts.slice(1));
      document.activeElement.blur(); // Commands should blur
    } else {
      this.hubChannel.sendMessage(message);
    }
  };

  dispatchCommand = async (command, ...args) => {
    const entered = this.scene.is("entered");
    uiRoot = uiRoot || document.getElementById("ui-root");
    const isGhost = !entered && uiRoot && uiRoot.firstChild && uiRoot.firstChild.classList.contains("isGhost");

    // TODO: Some of the commands below should be available without requiring room entry.
    if (!entered && (!isGhost || command === "duck")) {
      this.log(LogMessageType.roomEntryRequired);
      return;
    }

    const avatarRig = document.querySelector("#avatar-rig");
    const scales = [0.0625, 0.125, 0.25, 0.5, 1.0, 1.5, 3, 5, 7.5, 12.5];
    const curScale = avatarRig.object3D.scale;
    let err;
    let physicsSystem;
    const captureSystem = this.scene.systems["capture-system"];

    switch (command) {
      case "fly":
        if (this.scene.systems["hubs-systems"].characterController.fly) {
          this.scene.systems["hubs-systems"].characterController.enableFly(false);
          this.log(LogMessageType.flyModeDisabled);
        } else {
          if (this.scene.systems["hubs-systems"].characterController.enableFly(true)) {
            this.log(LogMessageType.flyModeEnabled);
          }
        }
        break;
      case "grow":
        for (let i = 0; i < scales.length; i++) {
          if (scales[i] > curScale.x) {
            avatarRig.object3D.scale.set(scales[i], scales[i], scales[i]);
            avatarRig.object3D.matrixNeedsUpdate = true;
            break;
          }
        }

        break;
      case "shrink":
        for (let i = scales.length - 1; i >= 0; i--) {
          if (curScale.x > scales[i]) {
            avatarRig.object3D.scale.set(scales[i], scales[i], scales[i]);
            avatarRig.object3D.matrixNeedsUpdate = true;
            break;
          }
        }

        break;
      case "leave":
        this.entryManager.exitScene();
        this.remountUI({ roomUnavailableReason: ExitReason.left });
        break;

      case "oldduck":
        spawnChatMessage(getAbsoluteHref(location.href, ducky));
        if (Math.random() < 0.01) {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPECIAL_QUACK);
        } else {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_QUACK);
        }
        break;
      case "duck":
        if (shouldUseNewLoader()) {
          const avatarPov = document.querySelector("#avatar-pov-node").object3D;
          const eid = createNetworkedEntity(APP.world, "duck");
          const obj = APP.world.eid2obj.get(eid);
          obj.position.copy(avatarPov.localToWorld(new THREE.Vector3(0, 0, -1.5)));
          obj.lookAt(avatarPov.getWorldPosition(new THREE.Vector3()));
        } else {
          spawnChatMessage(getAbsoluteHref(location.href, ducky));
        }
        if (Math.random() < 0.01) {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPECIAL_QUACK);
        } else {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_QUACK);
        }
        break;
      case "cube": {
        const avatarPov = document.querySelector("#avatar-pov-node").object3D;
        const eid = createNetworkedEntity(APP.world, "cube");
        const obj = APP.world.eid2obj.get(eid);
        obj.position.copy(avatarPov.localToWorld(new THREE.Vector3(0, 0, -1.5)));
        obj.lookAt(avatarPov.getWorldPosition(new THREE.Vector3()));
        break;
      }
      case "debug":
        physicsSystem = document.querySelector("a-scene").systems["hubs-systems"].physicsSystem;
        physicsSystem.setDebug(!physicsSystem.debugEnabled);
        break;
      case "vrstats":
        document.getElementById("stats").components["stats-plus"].toggleVRStats();
        break;
      case "scene":
        if (args[0]) {
          if (await isValidSceneUrl(args[0])) {
            err = this.hubChannel.updateScene(args[0]);
            if (err === "unauthorized") {
              this.log(LogMessageType.unauthorizedSceneChange);
            }
          } else {
            this.log(LogMessageType.invalidSceneUrl);
          }
        } else if (this.hubChannel.canOrWillIfCreator("update_hub")) {
          this.mediaSearchStore.sourceNavigateWithNoNav("scenes", "use");
        }

        break;
      case "rename":
        err = this.hubChannel.rename(args.join(" "));
        if (err === "unauthorized") {
          this.log(LogMessageType.unauthorizedRoomRename);
        }
        break;
      case "capture":
        if (!captureSystem.available()) {
          this.log(LogMessageType.captureUnavailable);
          break;
        }
        if (args[0] === "stop") {
          if (captureSystem.started()) {
            captureSystem.stop();
            this.log(LogMessageType.captureStopped);
          } else {
            this.log(LogMessageType.captureAlreadyStopped);
          }
        } else {
          if (captureSystem.started()) {
            this.log(LogMessageType.captureAlreadyRunning);
          } else {
            captureSystem.start();
            this.log(LogMessageType.captureStarted);
          }
        }
        break;
      case "audioNormalization":
        {
          if (args.length === 1) {
            const factor = Number(args[0]);
            if (!isNaN(factor)) {
              const effectiveFactor = Math.max(0.0, Math.min(255.0, factor));
              window.APP.store.update({
                preferences: { audioNormalization: effectiveFactor }
              });
              if (factor) {
                this.log(LogMessageType.setAudioNormalizationFactor, { factor: effectiveFactor });
              } else {
                this.log(LogMessageType.audioNormalizationDisabled);
              }
            } else {
              this.log(LogMessageType.audioNormalizationNaN);
            }
          } else {
            this.log(LogMessageType.invalidAudioNormalizationRange);
          }
        }
        break;
      case "add":
        {
          const avatarPov = document.querySelector("#avatar-pov-node").object3D;
          add(APP.world, avatarPov, args);
        }
        break;
      case "respawn":
        {
          const sceneEl = AFRAME.scenes[0];
          const characterController = this.scene.systems["hubs-systems"].characterController;
          respawn(APP.world, sceneEl, characterController);
        }
        break;
      case "test":
        {
          const avatarPov = document.querySelector("#avatar-pov-node").object3D;
          testAsset(APP.world, avatarPov, args);
        }
        break;
      case "load":
        {
          if (this.hubChannel.can("pin_objects") && this.hubChannel.signIn) {
            loadState(this.hubChannel, APP.world, args);
          }
        }
        break;
      case "clear":
        {
          if (this.hubChannel.can("pin_objects") && this.hubChannel.signIn) {
            clearState(this.hubChannel, APP.world);
          }
        }
        break;
    }
  };
}
