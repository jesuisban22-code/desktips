import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Scene from "./components/Scene"
import CharacterTest from "./components/CharacterTest"
import FurnitureTest from "./components/FurnitureTest"
import PipeTest from "./components/PipeTest"
import GaitTest from "./components/GaitTest"
import "./ui/overlay.css"

const debug = new URLSearchParams(window.location.search).get("debug")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {debug === "chars" ? <CharacterTest /> :
     debug === "gait"  ? <GaitTest /> :
     debug === "pipe"  ? <PipeTest /> :
     debug === "table" || debug === "piece" ? <FurnitureTest /> : <Scene />}
  </StrictMode>
)
