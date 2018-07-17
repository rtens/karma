const express = require('express');
const bodyParser = require('body-parser');
const karma = require('.');
const mongo = require('./src/persistence/mongo');
const nest = require('./src/persistence/nest');
const expressWs = require('express-ws');

let strategy = {
  onAccess: unit => {
    unit.takeSnapshot();
    if (unit.id == '__Domain-Demo') return;

    unit.unload();
  }
};

const uri = 'mongodb://localhost';
const db = 'test_karma3_20180717';
const oplogUri = 'mongodb://localhost/local';

const log = new mongo.EventLog(uri, oplogUri, db);
const snapshots = new mongo.SnapshotStore(uri, db);
const store = new mongo.EventStore(uri, db);

const metaLog = new mongo.EventLog(uri, oplogUri, db, '__meta');
const metaSnapshots = new mongo.SnapshotStore(uri, db, '__meta');
const metaStore = new mongo.EventStore(uri, db, '__meta');

const logger = new karma.logging.DebugLogger();

new karma.Domain('Noob',
  log, snapshots, store, metaLog, metaSnapshots, metaStore, strategy, logger);

new karma.Domain('Demo',
  log, snapshots, store, metaLog, metaSnapshots, metaStore, strategy, logger)

  .add(new karma.Aggregate('Bob')

    .initializing(function () {
      this.state = {
        total: 0,
        limit: 5
      }
    })

    .executing('Foo', $=>$.target, function ({count}) {
      if (this.state.total + count > this.state.limit) {
        throw new karma.Rejection('Too much');
      }
      return [
        new karma.Event('food', {count, total: this.state.total + count}),
        new karma.Event('bard', {foo: 42}),
      ]
    })

    .applying('food', function ({total}) {
      this.state.total = total;
    })

    .executing('Inc', $=>$.where, function ({by}) {
      return [new karma.Event('incd', {by})];
    })

    .applying('incd', function ({by}) {
      this.state.limit += by;
    })

    .executing('Bar', $=>$.to, function ({to}) {
      return [new karma.Event('bard', {foo: to})]
    }))

  .add(new karma.Projection('Alice')

    .initializing(function () {
      this.state = {
        total: 0
      }
    })

    .applying('food', function ({count}, {streamId}) {
      if (streamId != this.id) return;
      this.state.total += count;
    })

    .respondingTo('Food', $=>$.of, function () {
      return this.state.total;
    }))

  .add(new karma.Saga('John')

    .reactingTo('food', ()=>'paul', function (payload) {
      console.log('###########JOHN ' + JSON.stringify(payload));
    }))

  .add(new karma.Saga('Pete')

    .reactingTo('food', ()=>'pete', function (payload) {
      console.log('###########PETE ' + JSON.stringify(payload));
    }))

  .start()

  .then(domain => {

    const app = express();
    app.use(bodyParser.json());
    expressWs(app);

    app.post('/:command', (req, res) => {
      domain.execute(new karma.Command(req.params.command, req.body, Math.round(Math.random() * 1000000)))
        .then(() => res.send({success: true}))
        .catch(e => res.send({error: e.message}))
    });

    app.get('/:query', (req, res) => {
      domain.respondTo(new karma.Query(req.params.query, req.query.$ ? JSON.parse(req.query.$) : req.query))
        .then(response => res.send({data: response}))
        .catch(e => res.send({error: e.message}))
    });

    app.ws('/:query', function (ws, req) {
      console.log('message');
      const query = new karma.Query(req.params.query, req.query.$ ? JSON.parse(req.query.$) : req.query);
      domain.subscribeTo(query, (response) => {
        ws.send(JSON.stringify({data: response}))
      }).then(subscription => ws.on('close', () => {
        console.log('closed');
        subscription.cancel()
      }));
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Listening on port ${port}`));
  });

