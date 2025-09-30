import {Action, ActionPanel, Form, getPreferenceValues, Icon, showToast, Toast} from "@raycast/api";
import {useState} from "react";

const MAX_LEN = 65536;

type QuoteStyle = "french" | "german" | "english-double" | "programmer" | "english-single";
type OutputFormat = "named" | "numeric" | "unicode";

interface Preferences {
    quotes1: QuoteStyle;
    quotes2: QuoteStyle;
    outputFormat: OutputFormat;
    useBr?: boolean;
    brTag?: string;
    useP?: boolean;
    pOpen?: string;
    pClose?: string;
}

function escapeXml(input: string): string {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function decodeXmlLayer(input: string): string {
    // Decode only the XML layer to remove leading &amp; before HTML entities
    return input.replace(/&amp;/g, "&");
}

function decodeHtmlEntities(input: string): string {
    return input
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

function stripHtmlButKeepCustomTags(input: string, customTags: string[]): string {
    // First, protect our custom tags by replacing them with placeholders
    const protectedText = customTags.reduce((text, tag, index) => {
        const placeholder = `__CUSTOM_TAG_${index}__`;
        return text.replace(new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), placeholder);
    }, input);

    // Then strip all HTML (but keep our custom tags)
    const stripped = protectedText
        .replace(/<\/?p[^>]*>/gi, "")
        .replace(/<\/?nobr[^>]*>/gi, "")
        .replace(/<[^>]+>/g, "")
        .trim();

    // Restore our custom tags
    return customTags.reduce((text, tag, index) => {
        const placeholder = `__CUSTOM_TAG_${index}__`;
        return text.replace(new RegExp(placeholder, 'g'), tag);
    }, stripped);
}

function getQuotePair(style: QuoteStyle): { open: string; close: string } {
    switch (style) {
        case "french":
            return {open: "&laquo;", close: "&raquo;"};
        case "german":
            return {open: "&bdquo;", close: "&ldquo;"};
        case "english-double":
            return {open: "&ldquo;", close: "&rdquo;"};
        case "programmer":
            return {open: "&quot;", close: "&quot;"};
        case "english-single":
            return {open: "&lsquo;", close: "&rsquo;"};
    }
}

function normalizeQuotes(
    text: string,
    options: { quotes1: QuoteStyle; quotes2: QuoteStyle },
): string {
    const p = getQuotePair(options.quotes1);
    const s = getQuotePair(options.quotes2);

    // Map of known HTML entities and characters that Typograf may return
    const replacements: Array<[RegExp, string]> = [
        // Primary french « »
        [/&laquo;/g, p.open],
        [/&raquo;/g, p.close],
        [/«/g, p.open],
        [/»/g, p.close],

        // Secondary french ‹ ›
        [/&lsaquo;/g, s.open],
        [/&rsaquo;/g, s.close],
        [/‹/g, s.open],
        [/›/g, s.close],

        // German „ “ (secondary/primary in RU nesting)
        [/&bdquo;/g, s.open],
        [/&ldquo;/g, s.close],
        [/„/g, s.open],
        [/“/g, s.close],

        // English “ ”
        [/&ldquo;/g, p.open],
        [/&rdquo;/g, p.close],
        [/“/g, p.open],
        [/”/g, p.close],

        // English ‘ ’ and low ‘ ‚ for singles
        [/&lsquo;/g, s.open],
        [/&rsquo;/g, s.close],
        [/‘/g, s.open],
        [/’/g, s.close],
        [/&sbquo;/g, s.open],
        [/‚/g, s.open],
    ];

    let out = text;
    for (const [re, to] of replacements) {
        out = out.replace(re, to);
    }
    return out;
}

function convertEntities(text: string, output: OutputFormat): string {
    if (output === "named") return text;

    // Map a subset of named entities we produce to their code points
    const map: Record<string, number> = {
        "&laquo;": 171,
        "&raquo;": 187,
        "&lsaquo;": 8249,
        "&rsaquo;": 8250,
        "&bdquo;": 8222,
        "&ldquo;": 8220,
        "&lsquo;": 8216,
        "&rsquo;": 8217,
        "&sbquo;": 8218,
        "&quot;": 34,
        "&amp;": 38,
        "&lt;": 60,
        "&gt;": 62,
        "&nbsp;": 160,
        "&mdash;": 8212,
        "&ndash;": 8211,
    };

    return text.replace(/&[a-zA-Z]+?;/g, (m) => {
        const code = map[m];
        if (!code) return m;
        if (output === "numeric") return `&#${code};`;
        // unicode
        return String.fromCodePoint(code);
    });
}


function normalizeBr(text: string, brTag: string): string {
    const brEsc = brTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let out = text;
    // collapse consecutive <br> into single
    out = out.replace(new RegExp(`(${brEsc})(\\s*${brEsc})+`, "gi"), "$1");
    // remove any whitespace before <br>
    out = out.replace(new RegExp(`s+(${brEsc})`, "gi"), `$1`);
    // remove trailing <br> at end
    out = out.replace(new RegExp(`(?:\u00A0|\\s)*${brEsc}\\s*$`, "i"), "");
    return out;
}

function cleanParagraphs(text: string, pOpen: string, pClose: string, brTag: string): string {
    const openEsc = pOpen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const closeEsc = pClose.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const brEsc = brTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return text
        // Remove newlines/spaces after opening and before closing paragraph tags
        .replace(new RegExp(`${openEsc}\\s*\\n\\s*`, "g"), pOpen)
        .replace(new RegExp(`\\s*\\n\\s*${closeEsc}`, "g"), pClose)
        // Remove <br> and whitespace before closing </p>
        .replace(new RegExp(`\\s*${brEsc}\\s*${closeEsc}`, "gi"), pClose)
        // Remove all whitespace before closing </p>
        .replace(new RegExp(`\\s+${closeEsc}`, "gi"), pClose)
        // Normalize paragraph content
        .replace(new RegExp(`${openEsc}([\\s\\S]*?)${closeEsc}`, "g"), (match, content) => {
            const cleanContent = content.replace(/\\s+/g, ' ').trim();
            return `${pOpen}${cleanContent}${pClose}`;
        })
        // Final cleanup of double spaces
        .replace(/\\s{2,}/g, ' ');
}


async function callRemoteTypograf(
    text: string,
    options?: {
        entityType?: 1 | 2 | 3 | 4;
        useBr?: boolean;
        useP?: boolean;
        maxNobr?: number;
        quotes1?: QuoteStyle;
        quotes2?: QuoteStyle;
    },
) {
    const entityType = options?.entityType ?? 1; // html entities
    const useBr = options?.useBr ?? false;
    const useP = options?.useP ?? false;
    const maxNobr = options?.maxNobr ?? 0;
    const quotes1 = options?.quotes1 ?? "french";
    const quotes2 = options?.quotes2 ?? "german";

    const soapBody =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n` +
        `<soap:Body>\n` +
        ` <ProcessText xmlns="http://typograf.artlebedev.ru/webservices/">\n` +
        `  <text>${escapeXml(text)}</text>\n` +
        `  <entityType>${entityType}</entityType>\n` +
        `  <useBr>${useBr ? 1 : 0}</useBr>\n` +
        `  <useP>${useP ? 1 : 0}</useP>\n` +
        `  <maxNobr>${maxNobr}</maxNobr>\n` +
        `  <quotes1>${quotes1}</quotes1>\n` +
        `  <quotes2>${quotes2}</quotes2>\n` +
        ` </ProcessText>\n` +
        `</soap:Body>\n` +
        `</soap:Envelope>`;

    const res = await fetch(
        "https://typograf.artlebedev.ru/webservices/typograf.asmx",
        {
            method: "POST",
            headers: {
                "Content-Type": "text/xml",
                SOAPAction: '"http://typograf.artlebedev.ru/webservices/ProcessText"',
            },
            body: soapBody,
        },
    );

    const raw = await res.text();
    const startTag = "<ProcessTextResult>";
    const endTag = "</ProcessTextResult>";
    const start = raw.indexOf(startTag);
    const end = raw.indexOf(endTag);
    if (start === -1 || end === -1 || end <= start) throw new Error("Invalid response from Typograf service");
    const fragment = raw.slice(start + startTag.length, end);
    return decodeXmlLayer(fragment); // Return raw result without HTML stripping
}

export default function Command() {
    const [output, setOutput] = useState("");
    const prefs = getPreferenceValues<Preferences>();

    async function onSubmit(values: { source: string }) {
        let text = values.source ?? "";
        if (!text) {
            await showToast({
                style: Toast.Style.Failure,
                title: "No text",
                message: "Paste text to process with Typograf",
            });
            return;
        }

        if (text.length > MAX_LEN) {
            text = text.slice(0, MAX_LEN);
            await showToast({
                style: Toast.Style.Animated,
                title: "65,536 characters limit",
                message: "Text was truncated to the limit",
            });
        }

        try {
            const rawResult = await callRemoteTypograf(text, {
                entityType: 1,
                useBr: prefs.useBr,
                useP: prefs.useP,
                maxNobr: 0,
                quotes1: prefs.quotes1,
                quotes2: prefs.quotes2,
            });

            // Map service tags to user-defined tags before stripping
            let mapped = decodeHtmlEntities(rawResult);
            if (prefs.useBr) {
                const br = prefs.brTag || "<br />";
                mapped = mapped.replace(/<br\s*\/?>(\s*)/gi, br + "$1");
            }
            if (prefs.useP) {
                const pOpen = prefs.pOpen || "<p>";
                const pClose = prefs.pClose || "</p>";
                mapped = mapped.replace(/<p[^>]*>/gi, pOpen);
                mapped = mapped.replace(/<\/p>/gi, pClose);
            }

            // Protect selected tags and strip the rest
            const customTags: string[] = [];
            if (prefs.useBr && prefs.brTag) customTags.push(prefs.brTag);
            if (prefs.useP && prefs.pOpen) customTags.push(prefs.pOpen);
            if (prefs.useP && prefs.pClose) customTags.push(prefs.pClose);

            const cleaned = customTags.length > 0
                ? stripHtmlButKeepCustomTags(mapped, customTags)
                : mapped.replace(/<[^>]+>/g, "").trim();

            const normalized = normalizeQuotes(cleaned, {
                quotes1: prefs.quotes1,
                quotes2: prefs.quotes2,
            });
            let formatted = convertEntities(normalized, prefs.outputFormat);
            if (prefs.useBr) {
                const br = prefs.brTag || "<br />";
                formatted = normalizeBr(formatted, br);
            }
            if (prefs.useP) {
                const pOpen = prefs.pOpen || "<p>";
                const pClose = prefs.pClose || "</p>";
                const br = prefs.brTag || "<br />";
                formatted = cleanParagraphs(formatted, pOpen, pClose, br);
            }
            setOutput(formatted);
            await showToast({
                style: Toast.Style.Success,
                title: "Done",
                message: "Text has been typografed",
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            await showToast({
                style: Toast.Style.Failure,
                title: "Typograf error",
                message,
            });
        }
    }

    return (
        <Form
            navigationTitle='- Is this "Typograf"? — No, this is «Typograf»!'
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title="Typograf Text"
                        onSubmit={onSubmit}
                        icon={Icon.Text}
                    />
                    <Action.CopyToClipboard
                        title="Copy"
                        content={output}
                        shortcut={{modifiers: ["cmd"], key: "c"}}
                    />
                </ActionPanel>
            }
        >
            <Form.TextArea
                id="source"
                title="Text:"
                enableMarkdown={false}
                autoFocus
            />
            <Form.TextArea
                id="result"
                title="Result:"
                value={output}
                onChange={() => {
                }}
                enableMarkdown={false}
            />
            <Form.Description title="Limit:" text={`${MAX_LEN} characters`}/>
        </Form>
    );
}
