import { Text, View } from "react-native";
import { readingActionLabel } from "../lib/reading-ux";
import { useShelf } from "../lib/app-state";
import { chapterProgress, type Series } from "../lib/parser";
import { readingHistory } from "../lib/storage";
import { useReaderNavigation } from "./use-reader-navigation";
import { Pressable } from "./pressable";
import { color, Cover, Icon, ui } from "./ui";

export function ReadingShortcut({item, chapter}: {item:Series;chapter:string}) {
  const { read } = useShelf();
  const navigation = useReaderNavigation(item.slug,item.title,undefined,undefined,true);
  const fraction = chapterProgress(readingHistory()[item.slug],chapter);
  const saved = Boolean(item.localChapters?.includes(chapter));
  const label = readingActionLabel(chapter, saved, fraction, Boolean(read[item.slug]?.[chapter]));
  return <View style={ui.section}><Text style={ui.title}>Pick up where you left off</Text>
    <Pressable accessibilityLabel={`${label} · ${item.title}`} disabled={navigation.busy} onPress={()=>navigation.go(chapter)} style={[ui.row,{marginTop:14,padding:14,borderRadius:18,backgroundColor:color.surface,alignItems:"flex-start"}]}>
      <Cover item={item} style={{width:82,height:116,borderRadius:12}}/><View style={{flex:1,gap:8}}><Text numberOfLines={2} style={[ui.text,{fontSize:18,fontWeight:"800"}]}>{item.title}</Text><Text style={ui.muted}>{item.chapterTitles?.[chapter] || `Chapter ${chapter}`}</Text><View style={{height:3,backgroundColor:color.raised,borderRadius:3}}><View style={{height:3,width:`${fraction*100}%`,backgroundColor:color.lilac}}/></View><View style={[ui.row,{gap:5}]}><Icon name={saved?"play":"download-outline"} size={14} tint={color.lilac}/><Text style={{fontSize:12,color:color.lilac}}>{navigation.busy?"Preparing…":label}</Text></View></View>
    </Pressable>
    {navigation.needsVerification && <Pressable onPress={navigation.verify} style={{paddingVertical:12}}><Text style={{color:color.lilac}}>Verify and retry</Text></Pressable>}
    {navigation.status ? <Pressable accessibilityLabel={navigation.busy?"Cancel reader download":"Reading status"} onPress={navigation.cancel} style={{paddingVertical:10}}><Text accessibilityLiveRegion="polite" style={ui.muted}>{navigation.status}{navigation.busy?" · Cancel":""}</Text></Pressable>:null}
  </View>;
}
