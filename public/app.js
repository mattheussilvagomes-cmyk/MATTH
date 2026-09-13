(function () {
  'use strict';

  // Confirmação em formulários com data-confirm.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (form && form.dataset && form.dataset.confirm) {
      if (!window.confirm(form.dataset.confirm)) ev.preventDefault();
    }
  });

  // Menu responsivo.
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
  }

  // Selects que recarregam a página ao mudar (filtros).
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () {
      el.form && el.form.submit();
    });
  });

  // Aula individual: limita a seleção a um único aluno.
  var individual = document.querySelector('[data-individual-toggle]');
  var studentChecks = document.querySelectorAll('[data-student-check]');
  function applyIndividual() {
    if (!individual) return;
    var checked = Array.prototype.filter.call(studentChecks, function (c) { return c.checked; });
    if (individual.checked && checked.length > 1) {
      checked.slice(1).forEach(function (c) { c.checked = false; });
    }
  }
  if (individual) {
    individual.addEventListener('change', applyIndividual);
    studentChecks.forEach(function (c) {
      c.addEventListener('change', function () {
        if (individual.checked && c.checked) {
          studentChecks.forEach(function (o) { if (o !== c) o.checked = false; });
        }
      });
    });
  }

  // Rematrícula: mostra o campo de pedido de horário quando escolhe "alterar".
  document.querySelectorAll('[data-toggle-target]').forEach(function (el) {
    var target = document.querySelector(el.dataset.toggleTarget);
    if (!target) return;
    function update() {
      var group = document.querySelectorAll('input[name="' + el.name + '"]');
      var value = null;
      group.forEach(function (g) { if (g.checked) value = g.value; });
      target.hidden = value !== el.dataset.toggleValue;
    }
    el.addEventListener('change', update);
    update();
  });
  document.querySelectorAll('[data-toggle-decision]').forEach(function (el) {
    var target = document.querySelector('[data-confirm-fields]');
    function update() {
      var group = document.querySelectorAll('input[name="decisao"]');
      var value = null;
      group.forEach(function (g) { if (g.checked) value = g.value; });
      if (target) target.hidden = value === 'NAO_RENOVAR';
    }
    el.addEventListener('change', update);
    update();
  });
})();
