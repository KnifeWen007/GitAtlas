import { useState } from 'react';
import type { GitActionBody, RemoteInfo } from '../api.ts';
import { webUrlOf } from '../format.ts';

interface RemotePanelProps {
  remotes: RemoteInfo[];
  busy: boolean;
  onRun: (body: GitActionBody) => void;
}

/** 长地址只留域名和仓库名，够认人就行 */
function shorten(url: string): string {
  const web = webUrlOf(url);
  if (!web) return url;
  return web.replace(/^https?:\/\//, '');
}

export function RemotePanel({ remotes, busy, onRun }: RemotePanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [newName, setNewName] = useState(remotes.length === 0 ? 'origin' : '');
  const [newUrl, setNewUrl] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <>
      {remotes.length === 0 ? (
        <div className="empty-desc">还没有远端。填个地址，之后就能拉取和推送。</div>
      ) : null}

      {remotes.map((remote) => {
        const web = webUrlOf(remote.fetchUrl);
        const isEditing = editing === remote.name;
        return (
          <div className="remote-row" key={remote.name}>
            <div className="op-file">
              <code className="op-code">{remote.name}</code>
              {web ? (
                <a className="remote-link" href={web} target="_blank" rel="noreferrer" title={`在浏览器打开 ${web}`}>
                  {shorten(remote.fetchUrl)}
                </a>
              ) : (
                <span className="op-path" title={remote.fetchUrl}>
                  {remote.fetchUrl || '（本地路径）'}
                </span>
              )}
              <div className="op-file-actions">
                <button
                  className="btn btn-xs btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(isEditing ? null : remote.name);
                    setUrlDraft(remote.fetchUrl);
                  }}
                >
                  {isEditing ? '取消' : '改地址'}
                </button>
                <button className="btn btn-xs btn-ghost" disabled={busy} onClick={() => void copy(remote.fetchUrl)}>
                  {copied === remote.fetchUrl ? '已复制' : '复制'}
                </button>
                {confirmRemove === remote.name ? (
                  <button
                    className="btn btn-xs btn-danger"
                    disabled={busy}
                    onClick={() => {
                      onRun({ action: 'removeRemote', remote: remote.name });
                      setConfirmRemove(null);
                    }}
                  >
                    确认移除
                  </button>
                ) : (
                  <button
                    className="btn btn-xs btn-ghost"
                    disabled={busy}
                    onClick={() => setConfirmRemove(remote.name)}
                  >
                    移除
                  </button>
                )}
              </div>
            </div>

            {isEditing ? (
              <div className="op-buttons remote-edit">
                <input
                  className="op-input op-input-wide"
                  value={urlDraft}
                  onChange={(event) => setUrlDraft(event.target.value)}
                  placeholder="https://github.com/用户/仓库.git 或 git@github.com:用户/仓库.git"
                  disabled={busy}
                  autoFocus
                />
                <button
                  className="btn btn-sm btn-accent"
                  disabled={busy || urlDraft.trim().length === 0}
                  onClick={() => {
                    onRun({ action: 'setRemoteUrl', remote: remote.name, url: urlDraft.trim() });
                    setEditing(null);
                  }}
                >
                  保存地址
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="op-buttons remote-add">
        <input
          className="op-input remote-name"
          placeholder="远端名"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          disabled={busy}
        />
        <input
          className="op-input op-input-wide"
          placeholder="https://… 或 git@…"
          value={newUrl}
          onChange={(event) => setNewUrl(event.target.value)}
          disabled={busy}
        />
        <button
          className="btn btn-sm"
          disabled={busy || newName.trim().length === 0 || newUrl.trim().length === 0}
          onClick={() => {
            onRun({ action: 'addRemote', remote: newName.trim(), url: newUrl.trim() });
            setNewName('');
            setNewUrl('');
          }}
        >
          添加远端
        </button>
      </div>
    </>
  );
}
