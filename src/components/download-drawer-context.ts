import { createContext, useContext } from "react";

export const DownloadDrawerContext = createContext<() => void>(() => {});
export const useDownloadDrawer = () => useContext(DownloadDrawerContext);
