type Listener = () => void

function channel() {
  const listeners = new Set<Listener>()

  return {
    emit() {
      for (const listener of listeners) listener()
    },
    on(listener: Listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const localWrite = channel()
const remoteApplied = channel()

/** 本地发生了一次写入，outbox 里有东西可推 */
export const emitLocalWrite = localWrite.emit
export const onLocalWrite = localWrite.on

/** pull 把远端数据落库了，界面该刷新 */
export const emitRemoteApplied = remoteApplied.emit
export const onRemoteApplied = remoteApplied.on
