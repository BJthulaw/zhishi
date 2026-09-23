// Squirrel invokes these events during installation, upgrade and removal.
const path=require('node:path');
function installerAction(args,execPath){
 const event=args.find(value=>/^--squirrel-(install|updated|uninstall|obsolete)$/.test(value));
 if(!event)return null;
 if(event==='--squirrel-obsolete')return {args:[]};
 return {executable:path.resolve(path.dirname(execPath),'..','Update.exe'),args:[event==='--squirrel-uninstall'?'--removeShortcut':'--createShortcut',path.basename(execPath)]};
}
module.exports={installerAction};
