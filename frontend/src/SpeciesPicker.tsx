// 종명을 검색해 기존 종 번호를 선택하고 목록 순서를 유지한 채 현재 종으로 스크롤합니다.
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { Species } from './models'

export default function SpeciesPicker({species,value,onChange,name,required=false,disabled=false,autoFocus=false,emptyLabel='동정 미확정'}:{species:Species[];value:string;onChange:(id:string)=>void;name?:string;required?:boolean;disabled?:boolean;autoFocus?:boolean;emptyLabel?:string}) {
  const id=useId(),input=useRef<HTMLInputElement>(null),list=useRef<HTMLUListElement>(null)
  const [query,setQuery]=useState<string|null>(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1)
  const selected=species.find(item=>String(item.id)===value)
  const term=(query||'').trim().toLocaleLowerCase()
  const options=species.filter(item=>!term||`${item.korean_name} ${item.scientific_name||''}`.toLocaleLowerCase().includes(term))
  const invalid=(!selected&&(!!value||required||!!term))
  useLayoutEffect(()=>{input.current?.setCustomValidity(invalid?'검색 결과에서 종을 선택해 주세요.':'')},[invalid])
  useLayoutEffect(()=>{
    if(!open||!input.current||!list.current)return
    const panel=list.current,field=input.current
    function position(){
      const rect=field.getBoundingClientRect(),viewport=window.visualViewport
      const top=viewport?.offsetTop||0,bottom=top+(viewport?.height||window.innerHeight)
      const style=getComputedStyle(panel),row=parseFloat(style.getPropertyValue('--choice-row-height'))||32
      const wanted=Math.max(1,options.length)*row+2
      const below=bottom-rect.bottom-12,above=rect.top-top-12,up=below<wanted&&above>below
      const height=Math.max(0,Math.min(wanted,up?above:below))
      panel.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-rect.width-8))}px`
      panel.style.width=`${rect.width}px`
      panel.style.maxHeight=`${height}px`
      panel.style.setProperty('--species-visible-height',`${height}px`)
      panel.style.top=`${up?rect.top-height-4:rect.bottom+4}px`
    }
    if(typeof panel.showPopover==='function'&&!panel.matches(':popover-open'))panel.showPopover()
    position()
    const reposition=(event:Event)=>{if(event.target!==panel)position()}
    window.addEventListener('resize',position);window.addEventListener('scroll',reposition,true)
    window.visualViewport?.addEventListener('resize',position)
    return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',reposition,true);window.visualViewport?.removeEventListener('resize',position)}
  },[open,options.length])
  useLayoutEffect(()=>{
    if(!open||!list.current)return
    if(active<0)return
    const element=list.current.querySelector<HTMLElement>(`[data-species-index="${active}"]`)
    if(!element)return
    if(query===null&&String(options[active]?.id)===value) {
      list.current.scrollTop+=element.getBoundingClientRect().top-list.current.getBoundingClientRect().top-list.current.clientTop
    } else {
      const top=element.offsetTop,bottom=top+element.offsetHeight
      if(top<list.current.scrollTop)list.current.scrollTop=top
      else if(bottom>list.current.scrollTop+list.current.clientHeight)list.current.scrollTop=bottom-list.current.clientHeight
    }
  },[open,active,query,value,options])
  function reveal(){setOpen(true);setActive(Math.max(0,options.findIndex(item=>String(item.id)===value)))}
  function choose(item:Species){if(input.current?.matches(':disabled'))return;onChange(String(item.id));setQuery(null);setOpen(false);setActive(-1)}
  return <div className="species-picker">
    <label htmlFor={id}><span>종{required && <span className="required-mark" aria-label="필수"> *</span>}</span></label>
    <input ref={input} id={id} name={name?`${name}-search`:undefined} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open&&active>=0&&options[active]?`${id}-option-${options[active].id}`:undefined} aria-required={required} aria-invalid={invalid||undefined} autoComplete="off" autoFocus={autoFocus} disabled={disabled} placeholder="종명·학명 검색" value={query??selected?.korean_name??''}
      onFocus={event=>event.currentTarget.select()} onClick={()=>{if(!open)reveal()}} onBlur={()=>setOpen(false)}
      onChange={event=>{setQuery(event.target.value);onChange('');setActive(0);setOpen(true)}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return
        if(event.key==='ArrowDown'||event.key==='ArrowUp') {
          event.preventDefault()
          if(!open){reveal();return}
          setActive(index=>Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1))))
        } else if(event.key==='Enter'&&open) {
          event.preventDefault();if(options[active])choose(options[active])
        } else if(event.key==='Escape'&&open) {event.preventDefault();event.stopPropagation();setOpen(false)}
      }}/>
    {name&&<input type="hidden" name={name} value={value}/>}
    {!required&&<button className="species-clear" type="button" disabled={disabled} onClick={()=>{onChange('');setQuery(null);setOpen(false)}}>{emptyLabel}으로 지정</button>}
    {open&&<ul ref={list} popover="manual" id={`${id}-options`} role="listbox" aria-label="종 검색 결과" className="species-options">
      {options.map((item,index)=><li role="option" aria-selected={String(item.id)===value} id={`${id}-option-${item.id}`} key={item.id} data-species-index={index} title={[item.korean_name,item.scientific_name].filter(Boolean).join(' · ')} className={active===index?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}><span>{item.korean_name}</span>{item.scientific_name&&<small>{item.scientific_name}</small>}</li>)}
      {!options.length&&<li role="presentation" className="hint">검색 결과가 없습니다.</li>}
      {options.length>1&&query===null&&value&&<li role="presentation" aria-hidden="true" className="species-scroll-space"/>}
    </ul>}
  </div>
}
