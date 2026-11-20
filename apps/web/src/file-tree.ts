import type { TreeEntry } from './api.ts';

/**
 * 目录树节点。
 *
 * 文件列表是扁平的（`src/app.ts` 这种），树在浏览器这边拼：
 * 服务端省一次递归，切目录也不用再请求。
 */
export interface TreeNode {
  name: string;
  /** 相对仓库根的路径，也是选中/展开的键 */
  path: string;
  kind: 'dir' | 'file';
  /** 文件节点的来源信息；被忽略的折叠目录也会有 */
  entry: TreeEntry | null;
  children: TreeNode[];
  /** 子树里有多少个文件 */
  fileCount: number;
  /** 子树里有多少个有改动的文件 */
  changeCount: number;
}

function makeDir(name: string, path: string): TreeNode {
  return { name, path, kind: 'dir', entry: null, children: [], fileCount: 0, changeCount: 0 };
}

function aggregate(node: TreeNode): void {
  if (node.kind === 'file' || node.entry) {
    node.fileCount = 1;
    node.changeCount = node.entry?.change ? 1 : 0;
    return;
  }
  let files = 0;
  let changes = 0;
  for (const child of node.children) {
    aggregate(child);
    files += child.fileCount;
    changes += child.changeCount;
  }
  node.fileCount = files;
  node.changeCount = changes;
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) if (!node.entry) sortNodes(node.children);
}

/** 扁平路径列表 → 目录树；目录在前，同级按名字排 */
export function buildFileTree(entries: TreeEntry[]): TreeNode[] {
  const root = makeDir('', '');
  const dirs = new Map<string, TreeNode>([['', root]]);

  for (const entry of entries) {
    const parts = entry.path.split('/').filter((part) => part.length > 0);
    if (parts.length === 0) continue;

    let parent = root;
    let prefix = '';

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      prefix = prefix ? `${prefix}/${part}` : part;
      const isLast = i === parts.length - 1;

      if (!isLast) {
        let dir = dirs.get(prefix);
        if (!dir) {
          dir = makeDir(part, prefix);
          dirs.set(prefix, dir);
          parent.children.push(dir);
        }
        parent = dir;
        continue;
      }

      if (entry.directory) {
        // 整个被忽略的目录：一条记录就够，不再往里展开
        const leaf: TreeNode = {
          name: part,
          path: prefix,
          kind: 'dir',
          entry,
          children: [],
          fileCount: 1,
          changeCount: 0,
        };
        parent.children.push(leaf);
      } else {
        parent.children.push({
          name: part,
          path: prefix,
          kind: 'file',
          entry,
          children: [],
          fileCount: 1,
          changeCount: entry.change ? 1 : 0,
        });
      }
    }
  }

  for (const child of root.children) aggregate(child);
  sortNodes(root.children);
  return root.children;
}

/**
 * 按关键字过滤：命中的节点整枝留下，没命中的目录只剩还有命中子孙的那些。
 * 返回的是新节点，不改原树。
 */
export function filterFileTree(nodes: TreeNode[], keyword: string): TreeNode[] {
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0) return nodes;

  const walk = (node: TreeNode): TreeNode | null => {
    if (node.path.toLowerCase().includes(needle)) return node;
    if (node.kind === 'file' || node.entry) return null;
    const kept = node.children
      .map(walk)
      .filter((child): child is TreeNode => child !== null);
    if (kept.length === 0) return null;
    return { ...node, children: kept };
  };

  return nodes.map(walk).filter((node): node is TreeNode => node !== null);
}

/** 收集所有目录路径，用来「全部展开」 */
export function collectDirPaths(nodes: TreeNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind !== 'dir') continue;
    into.push(node.path);
    if (!node.entry) collectDirPaths(node.children, into);
  }
  return into;
}
