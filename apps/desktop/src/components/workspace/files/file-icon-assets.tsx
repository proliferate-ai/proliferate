import biomeIcon from "@/assets/file-icons/material/biome.svg?raw";
import cIcon from "@/assets/file-icons/material/c.svg?raw";
import shellIcon from "@/assets/file-icons/material/console.svg?raw";
import cppIcon from "@/assets/file-icons/material/cpp.svg?raw";
import cssIcon from "@/assets/file-icons/material/css.svg?raw";
import databaseIcon from "@/assets/file-icons/material/database.svg?raw";
import dockerIcon from "@/assets/file-icons/material/docker.svg?raw";
import documentIcon from "@/assets/file-icons/material/document.svg?raw";
import editorconfigIcon from "@/assets/file-icons/material/editorconfig.svg?raw";
import eslintIcon from "@/assets/file-icons/material/eslint.svg?raw";
import defaultFileIcon from "@/assets/file-icons/material/file.svg?raw";
import folderConfigOpenIcon from "@/assets/file-icons/material/folder-config-open.svg?raw";
import folderConfigIcon from "@/assets/file-icons/material/folder-config.svg?raw";
import folderDocsOpenIcon from "@/assets/file-icons/material/folder-docs-open.svg?raw";
import folderDocsIcon from "@/assets/file-icons/material/folder-docs.svg?raw";
import folderGitOpenIcon from "@/assets/file-icons/material/folder-git-open.svg?raw";
import folderGitIcon from "@/assets/file-icons/material/folder-git.svg?raw";
import folderImagesOpenIcon from "@/assets/file-icons/material/folder-images-open.svg?raw";
import folderImagesIcon from "@/assets/file-icons/material/folder-images.svg?raw";
import folderOpenIcon from "@/assets/file-icons/material/folder-open.svg?raw";
import folderSrcOpenIcon from "@/assets/file-icons/material/folder-src-open.svg?raw";
import folderSrcIcon from "@/assets/file-icons/material/folder-src.svg?raw";
import folderTestOpenIcon from "@/assets/file-icons/material/folder-test-open.svg?raw";
import folderTestIcon from "@/assets/file-icons/material/folder-test.svg?raw";
import folderIcon from "@/assets/file-icons/material/folder.svg?raw";
import gitIcon from "@/assets/file-icons/material/git.svg?raw";
import goModIcon from "@/assets/file-icons/material/go-mod.svg?raw";
import goIcon from "@/assets/file-icons/material/go.svg?raw";
import htmlIcon from "@/assets/file-icons/material/html.svg?raw";
import imageIcon from "@/assets/file-icons/material/image.svg?raw";
import javaIcon from "@/assets/file-icons/material/java.svg?raw";
import javascriptIcon from "@/assets/file-icons/material/javascript.svg?raw";
import jsonIcon from "@/assets/file-icons/material/json.svg?raw";
import envIcon from "@/assets/file-icons/material/key.svg?raw";
import kotlinIcon from "@/assets/file-icons/material/kotlin.svg?raw";
import licenseIcon from "@/assets/file-icons/material/license.svg?raw";
import lockIcon from "@/assets/file-icons/material/lock.svg?raw";
import makefileIcon from "@/assets/file-icons/material/makefile.svg?raw";
import markdownIcon from "@/assets/file-icons/material/markdown.svg?raw";
import npmIcon from "@/assets/file-icons/material/npm.svg?raw";
import phpIcon from "@/assets/file-icons/material/php.svg?raw";
import pnpmIcon from "@/assets/file-icons/material/pnpm.svg?raw";
import prettierIcon from "@/assets/file-icons/material/prettier.svg?raw";
import pythonIcon from "@/assets/file-icons/material/python.svg?raw";
import reactIcon from "@/assets/file-icons/material/react.svg?raw";
import reactTsIcon from "@/assets/file-icons/material/react_ts.svg?raw";
import readmeIcon from "@/assets/file-icons/material/readme.svg?raw";
import rubyIcon from "@/assets/file-icons/material/ruby.svg?raw";
import rustIcon from "@/assets/file-icons/material/rust.svg?raw";
import sassIcon from "@/assets/file-icons/material/sass.svg?raw";
import settingsIcon from "@/assets/file-icons/material/settings.svg?raw";
import svgIcon from "@/assets/file-icons/material/svg.svg?raw";
import swiftIcon from "@/assets/file-icons/material/swift.svg?raw";
import tableIcon from "@/assets/file-icons/material/table.svg?raw";
import testJsIcon from "@/assets/file-icons/material/test-js.svg?raw";
import testJsxIcon from "@/assets/file-icons/material/test-jsx.svg?raw";
import testTsIcon from "@/assets/file-icons/material/test-ts.svg?raw";
import tomlIcon from "@/assets/file-icons/material/toml.svg?raw";
import tsconfigIcon from "@/assets/file-icons/material/tsconfig.svg?raw";
import typescriptDefIcon from "@/assets/file-icons/material/typescript-def.svg?raw";
import typescriptIcon from "@/assets/file-icons/material/typescript.svg?raw";
import xmlIcon from "@/assets/file-icons/material/xml.svg?raw";
import yamlIcon from "@/assets/file-icons/material/yaml.svg?raw";
import yarnIcon from "@/assets/file-icons/material/yarn.svg?raw";
import type { FileVisualKind } from "@/lib/domain/files/file-visuals";

export type FileIconTone =
  | "accent"
  | "folder"
  | "muted"
  | "neutral"
  | "red";

function normalizeFileIconSvg(svg: string): string {
  return svg
    .replace(/\sfill="(?!none|currentColor)[^"]*"/g, ' fill="currentColor"')
    .replace(/\sstroke="(?!none|currentColor)[^"]*"/g, ' stroke="currentColor"');
}

// Vendored Material Icon Theme assets. See THIRD_PARTY_NOTICES.md for attribution.
export const FILE_ICON_ASSETS = {
  "biome": normalizeFileIconSvg(biomeIcon),
  "c": normalizeFileIconSvg(cIcon),
  "cpp": normalizeFileIconSvg(cppIcon),
  "css": normalizeFileIconSvg(cssIcon),
  "default": normalizeFileIconSvg(defaultFileIcon),
  "directory": normalizeFileIconSvg(folderIcon),
  "directory-config": normalizeFileIconSvg(folderConfigIcon),
  "directory-config-open": normalizeFileIconSvg(folderConfigOpenIcon),
  "directory-docs": normalizeFileIconSvg(folderDocsIcon),
  "directory-docs-open": normalizeFileIconSvg(folderDocsOpenIcon),
  "directory-git": normalizeFileIconSvg(folderGitIcon),
  "directory-git-open": normalizeFileIconSvg(folderGitOpenIcon),
  "directory-images": normalizeFileIconSvg(folderImagesIcon),
  "directory-images-open": normalizeFileIconSvg(folderImagesOpenIcon),
  "directory-open": normalizeFileIconSvg(folderOpenIcon),
  "directory-src": normalizeFileIconSvg(folderSrcIcon),
  "directory-src-open": normalizeFileIconSvg(folderSrcOpenIcon),
  "directory-test": normalizeFileIconSvg(folderTestIcon),
  "directory-test-open": normalizeFileIconSvg(folderTestOpenIcon),
  "docker": normalizeFileIconSvg(dockerIcon),
  "document": normalizeFileIconSvg(documentIcon),
  "editorconfig": normalizeFileIconSvg(editorconfigIcon),
  "env": normalizeFileIconSvg(envIcon),
  "eslint": normalizeFileIconSvg(eslintIcon),
  "git": normalizeFileIconSvg(gitIcon),
  "go": normalizeFileIconSvg(goIcon),
  "go-mod": normalizeFileIconSvg(goModIcon),
  "html": normalizeFileIconSvg(htmlIcon),
  "image": normalizeFileIconSvg(imageIcon),
  "java": normalizeFileIconSvg(javaIcon),
  "javascript": normalizeFileIconSvg(javascriptIcon),
  "json": normalizeFileIconSvg(jsonIcon),
  "kotlin": normalizeFileIconSvg(kotlinIcon),
  "license": normalizeFileIconSvg(licenseIcon),
  "lock": normalizeFileIconSvg(lockIcon),
  "makefile": normalizeFileIconSvg(makefileIcon),
  "markdown": normalizeFileIconSvg(markdownIcon),
  "npm": normalizeFileIconSvg(npmIcon),
  "php": normalizeFileIconSvg(phpIcon),
  "pnpm": normalizeFileIconSvg(pnpmIcon),
  "prettier": normalizeFileIconSvg(prettierIcon),
  "python": normalizeFileIconSvg(pythonIcon),
  "react": normalizeFileIconSvg(reactIcon),
  "react-ts": normalizeFileIconSvg(reactTsIcon),
  "readme": normalizeFileIconSvg(readmeIcon),
  "ruby": normalizeFileIconSvg(rubyIcon),
  "rust": normalizeFileIconSvg(rustIcon),
  "sass": normalizeFileIconSvg(sassIcon),
  "settings": normalizeFileIconSvg(settingsIcon),
  "shell": normalizeFileIconSvg(shellIcon),
  "sql": normalizeFileIconSvg(databaseIcon),
  "svg": normalizeFileIconSvg(svgIcon),
  "swift": normalizeFileIconSvg(swiftIcon),
  "table": normalizeFileIconSvg(tableIcon),
  "test-js": normalizeFileIconSvg(testJsIcon),
  "test-jsx": normalizeFileIconSvg(testJsxIcon),
  "test-ts": normalizeFileIconSvg(testTsIcon),
  "toml": normalizeFileIconSvg(tomlIcon),
  "tsconfig": normalizeFileIconSvg(tsconfigIcon),
  "typescript": normalizeFileIconSvg(typescriptIcon),
  "typescript-def": normalizeFileIconSvg(typescriptDefIcon),
  "xml": normalizeFileIconSvg(xmlIcon),
  "yaml": normalizeFileIconSvg(yamlIcon),
  "yarn": normalizeFileIconSvg(yarnIcon),
} as const satisfies Record<FileVisualKind, string>;

export const FILE_ICON_TONES = {
  "biome": "muted",
  "c": "neutral",
  "cpp": "neutral",
  "css": "accent",
  "default": "muted",
  "directory": "folder",
  "directory-config": "folder",
  "directory-config-open": "folder",
  "directory-docs": "folder",
  "directory-docs-open": "folder",
  "directory-git": "folder",
  "directory-git-open": "folder",
  "directory-images": "folder",
  "directory-images-open": "folder",
  "directory-open": "folder",
  "directory-src": "folder",
  "directory-src-open": "folder",
  "directory-test": "folder",
  "directory-test-open": "folder",
  "docker": "accent",
  "document": "neutral",
  "editorconfig": "muted",
  "env": "muted",
  "eslint": "muted",
  "git": "red",
  "go": "neutral",
  "go-mod": "muted",
  "html": "accent",
  "image": "muted",
  "java": "neutral",
  "javascript": "accent",
  "json": "muted",
  "kotlin": "neutral",
  "license": "neutral",
  "lock": "muted",
  "makefile": "accent",
  "markdown": "accent",
  "npm": "muted",
  "php": "neutral",
  "pnpm": "muted",
  "prettier": "muted",
  "python": "neutral",
  "react": "accent",
  "react-ts": "accent",
  "readme": "accent",
  "ruby": "neutral",
  "rust": "accent",
  "sass": "accent",
  "settings": "muted",
  "shell": "accent",
  "sql": "neutral",
  "svg": "accent",
  "swift": "neutral",
  "table": "muted",
  "test-js": "accent",
  "test-jsx": "accent",
  "test-ts": "accent",
  "toml": "muted",
  "tsconfig": "muted",
  "typescript": "accent",
  "typescript-def": "accent",
  "xml": "muted",
  "yaml": "muted",
  "yarn": "muted",
} as const satisfies Record<FileVisualKind, FileIconTone>;
