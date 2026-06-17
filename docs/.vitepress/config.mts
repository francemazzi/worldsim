import { defineConfig } from "vitepress";

export default defineConfig({
  title: "WorldSim",
  description:
    "Simulate how communities react to new rules, events, or policies — multi-agent simulation engine for TypeScript",
  base: "/worldsim/",
  cleanUrls: true,
  ignoreDeadLinks: true,
  markdown: {
    mermaid: true,
  },
  head: [
    ["link", { rel: "icon", href: "/worldsim/worldsim_img.webp", type: "image/webp" }],
  ],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/architecture" },
      { text: "Roadmap", link: "/ROADMAP" },
      {
        text: "GitHub",
        link: "https://github.com/francemazzi/worldsim",
      },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is WorldSim?", link: "/" },
        ],
      },
      {
        text: "Getting Started",
        items: [
          { text: "Quick Start", link: "/guide/getting-started" },
          { text: "Upgrading", link: "/guide/upgrading" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Simulation Time (Ticks)", link: "/guide/ticks" },
          { text: "Studio Dashboard", link: "/guide/studio" },
          { text: "Creating Scenarios", link: "/guide/creating-scenarios" },
          { text: "Example Scenarios", link: "/guide/example-scenarios" },
          { text: "Phones & Movement", link: "/guide/phones-and-movement" },
          { text: "Groups & Gatherings", link: "/guide/groups-and-gatherings" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Perception Layer", link: "/perception" },
          { text: "Plugins", link: "/plugins" },
          { text: "Persistence", link: "/persistence" },
          { text: "Scaling", link: "/scaling" },
          { text: "Federation", link: "/federation" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Roadmap", link: "/ROADMAP" },
          {
            text: "Contributing",
            link: "https://github.com/francemazzi/worldsim/blob/main/CONTRIBUTING.md",
          },
          {
            text: "Evaluation Scenarios",
            link: "https://github.com/francemazzi/worldsim/blob/main/evaluation/README.md",
          },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/francemazzi/worldsim" },
    ],
    editLink: {
      pattern: "https://github.com/francemazzi/worldsim/edit/main/docs/:path",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © WorldSim contributors",
    },
  },
});
