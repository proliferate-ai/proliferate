export interface ChangedFileTreeFile {
  key: string;
  path: string;
  displayPath: string;
}

export type ChangedFileTreeNode<TFile extends ChangedFileTreeFile = ChangedFileTreeFile> =
  | {
    kind: "directory";
    name: string;
    path: string;
    children: ChangedFileTreeNode<TFile>[];
  }
  | {
    kind: "file";
    name: string;
    path: string;
    file: TFile;
  };

interface MutableDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  childrenByName: Map<string, MutableTreeNode>;
}

type MutableTreeNode =
  | MutableDirectoryNode
  | {
    kind: "file";
    name: string;
    path: string;
    file: ChangedFileTreeFile;
  };

export function buildChangedFileTree<TFile extends ChangedFileTreeFile>(
  files: readonly TFile[],
): ChangedFileTreeNode<TFile>[] {
  const root: MutableDirectoryNode = {
    kind: "directory",
    name: "",
    path: "",
    childrenByName: new Map(),
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const childPath = directory.path ? `${directory.path}/${part}` : part;
      const existing = directory.childrenByName.get(part);
      if (existing?.kind === "directory") {
        directory = existing;
        continue;
      }
      const nextDirectory: MutableDirectoryNode = {
        kind: "directory",
        name: part,
        path: childPath,
        childrenByName: new Map(),
      };
      directory.childrenByName.set(part, nextDirectory);
      directory = nextDirectory;
    }

    const fileName = parts[parts.length - 1] ?? file.path;
    directory.childrenByName.set(fileName, {
      kind: "file",
      name: fileName,
      path: file.path,
      file,
    });
  }

  return materializeChildren(root.childrenByName) as ChangedFileTreeNode<TFile>[];
}

function materializeChildren(
  childrenByName: Map<string, MutableTreeNode>,
): ChangedFileTreeNode[] {
  return [...childrenByName.values()]
    .sort(compareTreeNodes)
    .map((node) => {
      if (node.kind === "file") {
        return node;
      }
      return {
        kind: "directory",
        name: node.name,
        path: node.path,
        children: materializeChildren(node.childrenByName),
      };
    });
}

function compareTreeNodes(left: MutableTreeNode, right: MutableTreeNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}
