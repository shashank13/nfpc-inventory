/* Account settings page. */
(function(){
  const ME=JSON.parse(document.getElementById("me-data").textContent);
  App.topbar(ME,"account");
  document.querySelectorAll("[data-dt]").forEach(el=>el.textContent=el.dataset.dt?App.fmtDateTime(el.dataset.dt):"—");
  const av=App.$("bigAvatar"); if(av) av.textContent=App.initials(ME.name);
  const em=App.$("email");
  if(em){ const orig=ME.email.trim().toLowerCase(); const upd=()=>App.$("curPwWrap").classList.toggle("hidden",em.value.trim().toLowerCase()===orig); em.addEventListener("input",upd); upd(); }
})();
