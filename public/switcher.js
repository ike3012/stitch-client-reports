// Jump straight to the chosen month when the dropdown changes.
(function () {
  var select = document.getElementById('month');
  if (!select) return;
  select.addEventListener('change', function () {
    select.form.submit();
  });
})();
