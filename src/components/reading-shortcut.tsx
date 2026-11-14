import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { readingActionLabel } from "../lib/reading-ux";
import { useShelf } from "../lib/app-state";
import { chapterProgress, type Series } from "../lib/parser";
import { readingHistory } from "../lib/storage";
import { useReaderNavigation } from "./use-reader-navigation";
import { Pressable } from "./pressable";
import { color, Cover, Icon, ui } from "./ui";

export function ReadingShortcut({item, chapter}: {item:Series;chapter:string}) {
  const { read, catalogReady } = useShelf();
  const navigation = useReaderNavigation(item.slug,item.title,undefined,undefined,true);
  const history = readingHistory()[item.slug];
  const fraction = read[item.slug]?.[chapter] ? 1 : chapterProgress(history,chapter);
  const resumable = history?.chapter === chapter || Boolean(history?.chapters?.[chapter]);
  const saved = Boolean(item.localChapters?.includes(chapter));
  const label = saved && resumable && !read[item.slug]?.[chapter] ? `Resume chapter ${chapter}` : readingActionLabel(chapter, saved, fraction, Boolean(read[item.slug]?.[chapter]));
  return <View style={ui.section}><Text style={ui.title}>Continue reading</Text>
    <View style={[ui.row,{marginTop:14,padding:14,paddingRight:4,borderRadius:18,backgroundColor:color.surface}]}>
    <Pressable accessibilityLabel={`${catalogReady ? label : "Checking saved chapter"} · ${item.title}`} disabled={!catalogReady || navigation.busy} onPress={()=>navigation.go(chapter)} style={[ui.row,{flex:1,alignItems:"flex-start"}]}>
      <Cover item={item} style={{width:82,height:116,borderRadius:12}}/><View style={{flex:1,gap:8}}><Text numberOfLines={2} style={[ui.text,{fontSize:18,fontWeight:"800"}]}>{item.title}</Text><Text style={ui.muted}>{item.chapterTitles?.[chapter] || `Chapter ${chapter}`}</Text><View style={{height:3,backgroundColor:color.raised,borderRadius:3}}><View style={{height:3,width:`${(navigation.busy ? navigation.progress || 0 : fraction)*100}%`,backgroundColor:color.lilac}}/></View><View style={[ui.row,{gap:5}]}>{!catalogReady ? <ActivityIndicator size="small" color={color.lilac}/> : <Icon name={navigation.busy?"download-outline":saved?"play":"download-outline"} size={14} tint={color.lilac}/>}<Text style={{fontSize:12,color:color.lilac}}>{!catalogReady?"Checking saved chapter…":navigation.busy?"Preparing…":!saved?"Download & read":read[item.slug]?.[chapter]?"Read again":resumable?"Resume":"Start"}</Text></View></View>
    </Pressable>
    <Pressable accessibilityLabel={`Chapter list for ${item.title}`} onPress={() => router.push({pathname:"/series/[slug]",params:{slug:item.slug,chapters:"1"}})} style={{minWidth:48,minHeight:48,alignItems:"center",justifyContent:"center",alignSelf:"center"}}><Icon name="reorder-three-outline" tint={color.lilac}/></Pressable>
    </View>
    {navigation.needsVerification && <Pressable onPress={navigation.verify} style={{paddingVertical:12}}><Text style={{color:color.lilac}}>Verify and retry</Text></Pressable>}
    {navigation.status ? <Pressable accessibilityLabel={navigation.busy?"Cancel reader download":"Reading status"} onPress={navigation.cancel} style={{paddingVertical:10}}><Text accessibilityLiveRegion="polite" style={ui.muted}>{navigation.status}{navigation.busy?" · Cancel":""}</Text></Pressable>:null}
  </View>;
}
