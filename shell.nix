with import <nixpkgs> {};
  mkShell {
    name = "obsidian-plugin";
    packages = [
      nodejs_24
    ];
  }
