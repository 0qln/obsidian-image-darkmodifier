with import <nixpkgs> { };

mkShell {
  name = "obsidian-plugin";
  packages = [
    nodejs_24
  ];
  shellHook = ''
    npm run dev &
  '';
}
