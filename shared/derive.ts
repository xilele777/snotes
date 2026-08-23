import type {DerivedFields} from './types'
export const TITLE_MAX=64, SUMMARY_MAX=120, IMAGE_URL_PREFIX='/api/images/'
const IMAGE_RE=/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g
export function extractTitle(md:string):string{const line=md.split(/\r?\n/).find(l=>l.trim()!=='');if(!line)return '';return line.trim().replace(/^#{1,6}\s+/,'').trim().slice(0,TITLE_MAX)}
export function extractSummary(md:string):string{return md.replace(IMAGE_RE,' ').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/^\s{0,3}>\s?/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim().slice(0,SUMMARY_MAX)}
export function extractThumbnail(md:string):string|null{for(const m of md.matchAll(IMAGE_RE)){if(m[1].startsWith(IMAGE_URL_PREFIX))return m[1].slice(IMAGE_URL_PREFIX.length)}return null}
export function derive(md:string):DerivedFields{return {title:extractTitle(md),summary:extractSummary(md),thumbnail:extractThumbnail(md)}}
export const titleFromMarkdown=extractTitle,summaryFromMarkdown=extractSummary,thumbnailFromMarkdown=extractThumbnail
