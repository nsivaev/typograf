/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `typograf` command */
  export type Typograf = ExtensionPreferences & {
  /** Primary quotes - Style for first-level quotes */
  "quotes1": "french" | "german" | "english-double" | "programmer" | "english-single",
  /** Secondary quotes - Style for second-level quotes */
  "quotes2": "french" | "german" | "english-double" | "programmer" | "english-single",
  /** Output format - How to render characters in the result */
  "outputFormat": "named" | "numeric" | "unicode",
  /** Insert line breaks - Replace newlines with a tag */
  "useBr": boolean,
  /** Break tag - Tag inserted on each newline when line breaks are enabled */
  "brTag": string,
  /** Wrap paragraphs - Wrap separated blocks with tags */
  "useP": boolean,
  /** Paragraph open tag - Opening tag for each paragraph when wrapping is enabled */
  "pOpen": string,
  /** Paragraph close tag - Closing tag for each paragraph when wrapping is enabled */
  "pClose": string,
  /** Show browser preview - Display a plain-text preview as it would look in a browser */
  "showPreview": boolean
}
}

declare namespace Arguments {
  /** Arguments passed to the `typograf` command */
  export type Typograf = {}
}

