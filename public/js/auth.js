/* Sign-in / password pages: show-password buttons and the new-password strength meter. */
(function(){
  document.querySelectorAll(".pw-toggle").forEach(b=>{ if(!b.innerHTML.trim()) b.innerHTML=App.icon("eye"); });
  const pw=document.querySelector("[data-meter]");
  if(pw) App.passwordMeter(pw,{meter:App.$("pwMeter"),rules:App.$("pwRules"),confirm:App.$(pw.dataset.confirm),match:App.$(pw.dataset.match)});
})();
