const express = require('express');
const bodyParser = require('body-parser');
const karma = require('./src/karma');
const flatFile = require('./src/persistence/flat-file');

class RepositoryStrategy extends karma.RepositoryStrategy {
  notifyAccess(unit) {
    unit.takeSnapshot();
    this.repository.unload(unit);
  }
}

const domain = new karma.Domain(new flatFile.EventBus('./data'), new flatFile.SnapshotStore('./data'), new RepositoryStrategy())

  .add(new karma.Aggregate('Test')

    .init(function () {
      this.total = 0;
    })

    .applying('food', e=>e.payload.to, function (e) {
      this.total = e.payload.total;
    })

    .executing('Foo', e=>e.payload.target, function ({payload:{target, count}}) {
      return [new karma.Event('food', {to: target, total: this.total + count})]
    }));


var app = express();
app.use(bodyParser.json());

app.post('/:command', (req, res) => {
  domain.execute(new karma.Command(req.params.command, req.body, Math.round(Math.random() * 1000000)))
    .then(() => res.send({success: true}))
    .catch(e => res.send({error: e.message}))
});

var port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));

