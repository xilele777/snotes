const TAG_OPEN=/<(?=[!?/a-zA-Z])/g
export function escapeRawHtml(md:string):string{
  const lines=md.split(/\r?\n/),out:string[]=[];let fence:string|null=null
  for(const line of lines){const fm=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(fm){if(!fence)fence=fm[1][0];else if(fence===fm[1][0])fence=null;out.push(line);continue}if(fence||/^\s{4,}|^\s*\t/.test(line)){out.push(line);continue}
    const masks:string[]=[];let s=line.replace(/(`+[^`]*`+)/g,m=>{masks.push(m);return `\u0000${masks.length-1}\u0000`});s=s.replace(TAG_OPEN,'&lt;');s=s.replace(/\u0000(\d+)\u0000/g,(_,i)=>masks[Number(i)]);out.push(s)
  }return out.join('\n')
}
